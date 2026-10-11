// Boucle du service mail. Toutes les dépendances (file, transport, horloge,
// battement, signal d'arrêt) sont injectées : les tests la font tourner
// sans base ni réseau.
//
// Une ligne réclamée finit toujours de l'une de ces façons : envoyée,
// reprise plus tard, abandonnée avec un code, ou remise en file sans
// tentative consommée (configuration, arrêt). Livraison au moins une fois :
// un plantage entre l'acceptation du fournisseur et la clôture produit un
// doublon inoffensif, même lien et même contenu.

import {
  CIRCUIT_CLOSED,
  MAX_SEND_ATTEMPTS,
  circuitGate,
  circuitNext,
  nextAttemptAt,
  type CircuitState,
  type ProviderVerdict,
} from '@toron/core';
import type { ClaimedEmail, EmailOutboxHealthRow } from '@toron/db';
import { EMAIL_KINDS, emailLink, open, parseEmailParams, render, type EmailKind, type RenderedEmail } from '@toron/mail';

import type { Heartbeat } from './heartbeat.ts';
import { errorCode, logMail, type MailEvent } from './log.ts';
import { recipientPermitted, type Mailer, type RecipientPolicy, type SendOutcome } from './mailer.ts';

export interface MailQueue {
  claim(): Promise<ClaimedEmail | null>;
  markSent(id: string, leaseToken: string, providerMessageId: string | null): Promise<boolean>;
  markFailed(id: string, leaseToken: string, code: string, retryAt: Date | null): Promise<'a_envoyer' | 'echec' | 'expire' | null>;
  release(id: string, leaseToken: string): Promise<boolean>;
  purge(retentionDays: number): Promise<number>;
  health(): Promise<EmailOutboxHealthRow[]>;
}

export interface Clock {
  now(): Date;
  /** Se résout au plus tard à l'arrêt demandé. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface MailProcessDeps {
  queue: MailQueue;
  mailer: Mailer;
  /** Clé courante puis, pendant une rotation, la précédente. */
  keys: readonly Uint8Array[];
  publicBaseUrl: string;
  recipients: RecipientPolicy;
  suspended: boolean;
  pollMs: number;
  clock: Clock;
  heartbeat(beat: Heartbeat): Promise<void>;
  signal: AbortSignal;
}

export const PURGE_RETENTION_DAYS = 30;
const PURGE_EVERY_MS = 3_600_000;
const SUMMARY_EVERY_MS = 60_000;
const PENDING_ALERT_SECONDS = 300;
const CIRCUIT_ALERT_MS = 600_000;

export type TickResult = 'suspendu' | 'disjoncteur' | 'vide' | 'traite';

export interface MailProcessor {
  /** Un tour : au plus une ligne réclamée et menée à son terme. */
  tick(): Promise<TickResult>;
  /** Tourne jusqu'à l'arrêt demandé, envoi en cours compris. */
  run(): Promise<void>;
  circuit(): CircuitState;
}

type Prepared =
  | { ok: true; email: RenderedEmail }
  | { ok: false; code: 'PARAMETRES_INVALIDES' | 'SECRET_ILLISIBLE' | 'DESTINATAIRE_REFUSE' | 'RENDU_IMPOSSIBLE' };

const PREPARE_EVENTS: Record<Exclude<Prepared, { ok: true }>['code'], MailEvent> = {
  PARAMETRES_INVALIDES: 'parametres_invalides',
  SECRET_ILLISIBLE: 'secret_illisible',
  DESTINATAIRE_REFUSE: 'destinataire_refuse',
  RENDU_IMPOSSIBLE: 'rendu_impossible',
};

export function createMailProcessor(deps: MailProcessDeps): MailProcessor {
  let circuit: CircuitState = CIRCUIT_CLOSED;
  let circuitOpenedAt: number | null = null;
  let suspensionLogged = false;
  let lastExpirations = 0;

  // Revalidation complète de la ligne : la base n'est pas une source de confiance.
  function prepare<K extends EmailKind>(kind: K, row: ClaimedEmail, now: Date): Prepared {
    const params = parseEmailParams(kind, row.params);
    if (params === null) return { ok: false, code: 'PARAMETRES_INVALIDES' };
    let secret: string | null = null;
    if (EMAIL_KINDS[kind].secret !== null) {
      if (row.secretBox === null || row.secretKeyId === null) return { ok: false, code: 'SECRET_ILLISIBLE' };
      secret = open(deps.keys, { id: row.id, kind, keyId: row.secretKeyId }, row.secretBox);
      if (secret === null) return { ok: false, code: 'SECRET_ILLISIBLE' };
    } else if (row.secretBox !== null) {
      return { ok: false, code: 'SECRET_ILLISIBLE' };
    }
    let link: string;
    try {
      link = emailLink(kind, deps.publicBaseUrl, secret);
    } catch {
      return { ok: false, code: 'SECRET_ILLISIBLE' };
    }
    if (!recipientPermitted(row.recipient, deps.recipients)) return { ok: false, code: 'DESTINATAIRE_REFUSE' };
    try {
      return { ok: true, email: render(kind, { params, link, origin: deps.publicBaseUrl, now }) };
    } catch {
      return { ok: false, code: 'RENDU_IMPOSSIBLE' };
    }
  }

  function updateCircuit(verdict: ProviderVerdict, now: Date): void {
    const before = circuit;
    circuit = circuitNext(before, verdict, now);
    if (circuit.phase === 'ouvert' && (before.phase !== 'ouvert' || circuit.openUntil !== before.openUntil)) {
      circuitOpenedAt ??= now.getTime();
      const secondes = circuit.openUntil === null ? 0 : (circuit.openUntil - now.getTime()) / 1000;
      logMail('disjoncteur_ouvert', { secondes, ...('code' in verdict ? { code: verdict.code } : {}) });
    } else if (circuit.phase === 'ferme' && before.phase !== 'ferme') {
      circuitOpenedAt = null;
      logMail('disjoncteur_ferme');
    }
  }

  async function send(row: ClaimedEmail, email: RenderedEmail): Promise<SendOutcome> {
    try {
      return await deps.mailer.send({
        reference: row.id,
        to: row.recipient,
        subject: email.subject,
        text: email.text,
        html: email.html,
        sendBefore: row.expiresAt,
      });
    } catch {
      // Un transport ne lève jamais ; si cela arrive, l'envoi est repris.
      return { ok: false, verdict: { effect: 'reprise', code: 'RESEAU' } };
    }
  }

  async function handle(row: ClaimedEmail, gate: CircuitState): Promise<void> {
    const ids = { outboxId: row.id, correlationId: row.correlationId, kind: row.kind, attempts: row.attempts };
    const releaseOnStop = async (): Promise<void> => {
      const done = await deps.queue.release(row.id, row.leaseToken);
      logMail(done ? 'libere_arret' : 'bail_perdu', ids);
    };

    if (deps.signal.aborted) return releaseOnStop();
    const prepared = prepare(row.kind, row, deps.clock.now());
    if (!prepared.ok) {
      const status = await deps.queue.markFailed(row.id, row.leaseToken, prepared.code, null);
      logMail(status === null ? 'bail_perdu' : PREPARE_EVENTS[prepared.code], { ...ids, code: prepared.code });
      return;
    }
    if (deps.signal.aborted) return releaseOnStop();

    // En semi-ouverture, cet envoi est l'unique essai autorisé.
    circuit = gate;
    const outcome = await send(row, prepared.email);
    const now = deps.clock.now();

    if (outcome.ok) {
      updateCircuit({ effect: 'envoye' }, now);
      const done = await deps.queue.markSent(row.id, row.leaseToken, outcome.providerMessageId);
      logMail(done ? 'envoye' : 'bail_perdu', { ...ids, transport: deps.mailer.transport });
      return;
    }

    const { verdict } = outcome;
    updateCircuit(verdict, now);
    const detail = {
      ...ids,
      code: verdict.code,
      ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
    };
    if (verdict.effect === 'liberation') {
      const done = await deps.queue.release(row.id, row.leaseToken);
      logMail(done ? 'configuration' : 'bail_perdu', outcome.cause === undefined ? detail : { ...detail, code: outcome.cause });
      return;
    }
    if (verdict.effect === 'definitif') {
      const status = await deps.queue.markFailed(row.id, row.leaseToken, verdict.code, null);
      logMail(status === null ? 'bail_perdu' : 'echec', detail);
      return;
    }
    // Sans date possible avant l'expiration, la ligne expire ; tentatives épuisées, elle échoue.
    const retryAt = nextAttemptAt(now, row.attempts, row.expiresAt, outcome.retryAfterSeconds)
      ?? (row.attempts < 1 || row.attempts >= MAX_SEND_ATTEMPTS ? null : row.expiresAt);
    const status = await deps.queue.markFailed(row.id, row.leaseToken, verdict.code, retryAt);
    const event: MailEvent = status === 'a_envoyer' ? 'reprise' : status === 'expire' ? 'expire' : status === 'echec' ? 'echec' : 'bail_perdu';
    logMail(event, detail);
  }

  async function tick(): Promise<TickResult> {
    if (deps.suspended) {
      if (!suspensionLogged) logMail('suspendu');
      suspensionLogged = true;
      return 'suspendu';
    }
    // L'état « semi-ouvert » n'est retenu qu'au moment d'un envoi réel : une
    // file vide ou une ligne abandonnée avant l'envoi ne consomme pas l'essai.
    const gate = circuitGate(circuit, deps.clock.now());
    if (!gate.allowed) return 'disjoncteur';
    if (deps.signal.aborted) return 'vide';
    const row = await deps.queue.claim();
    if (row === null) return 'vide';
    await handle(row, gate.state);
    return 'traite';
  }

  async function purge(): Promise<void> {
    try {
      const n = await deps.queue.purge(PURGE_RETENTION_DAYS);
      if (n > 0) logMail('purge', { purgees: n });
    } catch (err) {
      logMail('erreur_base', { code: errorCode(err) });
    }
  }

  async function summary(now: number): Promise<void> {
    try {
      const rows = await deps.queue.health();
      const pending = rows.filter((r) => r.status === 'a_envoyer' || r.status === 'en_cours');
      const backlog = pending.reduce((sum, r) => sum + r.count, 0);
      const oldest = pending.reduce((max, r) => Math.max(max, r.oldestPendingSeconds ?? 0), 0);
      const echecs = rows.filter((r) => r.status === 'echec' || r.status === 'expire').reduce((sum, r) => sum + r.count, 0);
      logMail('synthese', { backlog, secondes: oldest, echecs });
      if (oldest > PENDING_ALERT_SECONDS) logMail('file_en_retard', { backlog, secondes: oldest });
      // Toutes les expirations, celles décidées à la réclamation comprises :
      // signalées dès que le compte glissant sur une heure augmente.
      const expirations = rows
        .filter((r) => r.kind === 'mot_de_passe_reinitialisation' && r.status === 'expire')
        .reduce((sum, r) => sum + r.countLastHour, 0);
      if (expirations > lastExpirations) {
        logMail('liens_expires', { kind: 'mot_de_passe_reinitialisation', expirations });
      }
      lastExpirations = expirations;
    } catch (err) {
      logMail('erreur_base', { code: errorCode(err) });
    }
    // Délai d'ouverture écoulé, le disjoncteur ne bloque plus rien : il attend seulement un envoi.
    const blocking = !circuitGate(circuit, new Date(now)).allowed;
    if (blocking && circuitOpenedAt !== null && now - circuitOpenedAt > CIRCUIT_ALERT_MS) {
      logMail('disjoncteur_prolonge', { secondes: (now - circuitOpenedAt) / 1000 });
    }
  }

  async function run(): Promise<void> {
    let lastPurge = Number.NEGATIVE_INFINITY;
    let lastSummary = Number.NEGATIVE_INFINITY;
    while (!deps.signal.aborted) {
      const now = deps.clock.now().getTime();
      if (now - lastPurge >= PURGE_EVERY_MS) {
        lastPurge = now;
        await purge();
      }
      if (now - lastSummary >= SUMMARY_EVERY_MS) {
        lastSummary = now;
        await summary(now);
      }
      let result: TickResult | 'erreur';
      try {
        result = await tick();
      } catch (err) {
        logMail('erreur_base', { code: errorCode(err) });
        result = 'erreur';
      }
      // Pas de battement après une erreur : une base injoignable rend le service malade.
      if (result !== 'erreur') {
        const etat = result === 'suspendu' ? 'suspendu' : result === 'disjoncteur' ? 'disjoncteur' : 'actif';
        try {
          await deps.heartbeat({ at: deps.clock.now().toISOString(), etat });
        } catch (err) {
          logMail('erreur_battement', { code: errorCode(err) });
        }
      }
      if (result !== 'traite') await deps.clock.sleep(deps.pollMs, deps.signal);
    }
  }

  return { tick, run, circuit: () => circuit };
}
