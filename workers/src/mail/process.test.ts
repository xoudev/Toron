import { randomUUID } from 'node:crypto';

import type { ClaimedEmail, EmailOutboxHealthRow } from '@toron/db';
import { deriveOutboxKey, keyId, seal } from '@toron/mail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Heartbeat } from './heartbeat.ts';
import type { SendFailure } from './mailer.ts';
import { createMailProcessor, type MailQueue } from './process.ts';
import { createMemoireMailer } from './transports/memoire.ts';

const KEY = deriveOutboxKey('dev_local_cle_courriel_32_caracteres_min');
const OTHER_KEY = deriveOutboxKey('autre_cle_de_developpement_32_caracteres');
const TOKEN = 'JetonDeTest0000000000000';
const NOW = new Date('2026-10-10T12:00:00.000Z');
const ORIGIN = 'http://localhost:3000';
const RECIPIENT = 'camille.poirier@meridiane-logistics.fr';

const UNAVAILABLE: SendFailure = { ok: false, verdict: { effect: 'reprise', code: 'FOURNISSEUR_INDISPONIBLE' }, httpStatus: 503 };
const UNAUTHORIZED: SendFailure = { ok: false, verdict: { effect: 'liberation', code: 'CONFIGURATION' }, httpStatus: 401 };
const REFUSED: SendFailure = { ok: false, verdict: { effect: 'definitif', code: 'REFUS_FOURNISSEUR' }, httpStatus: 400 };

function resetRow(overrides: Partial<ClaimedEmail> = {}): ClaimedEmail {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    kind: 'mot_de_passe_reinitialisation',
    recipient: RECIPIENT,
    params: {},
    secretBox: seal(KEY, { id, kind: 'mot_de_passe_reinitialisation' }, TOKEN),
    secretKeyId: keyId(KEY),
    attempts: 1,
    expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    leaseToken: randomUUID(),
    correlationId: randomUUID(),
    ...overrides,
  };
}

function changedRow(overrides: Partial<ClaimedEmail> = {}): ClaimedEmail {
  return resetRow({
    kind: 'mot_de_passe_modifie',
    params: { modifieLe: '2026-10-10T12:32:00.000Z' },
    secretBox: null,
    secretKeyId: null,
    ...overrides,
  });
}

interface Call {
  op: 'sent' | 'failed' | 'release';
  id: string;
  code?: string;
  retryAt?: Date | null;
}

interface Options {
  blockReserved?: boolean;
  allowlist?: string[] | null;
  suspended?: boolean;
  keys?: Uint8Array[];
}

function setup(rows: ClaimedEmail[], options: Options = {}) {
  const pending = [...rows];
  const claimed = new Map<string, ClaimedEmail>();
  const calls: Call[] = [];
  let claims = 0;
  let purges = 0;
  const queue: MailQueue = {
    claim: async () => {
      claims++;
      const next = pending.shift() ?? null;
      if (next !== null) claimed.set(next.id, next);
      return next;
    },
    markSent: async (id) => { calls.push({ op: 'sent', id }); return true; },
    markFailed: async (id, _lease, code, retryAt) => {
      calls.push({ op: 'failed', id, code, retryAt });
      // Même règle que mark_email_failed : une reprise à l'expiration ou au-delà fait expirer.
      const expiresAt = claimed.get(id)?.expiresAt;
      if (retryAt === null) return 'echec';
      return expiresAt !== undefined && retryAt.getTime() >= expiresAt.getTime() ? 'expire' : 'a_envoyer';
    },
    release: async (id) => { calls.push({ op: 'release', id }); return true; },
    purge: async () => { purges++; return 0; },
    health: async () => [],
  };
  let time = NOW.getTime();
  const controller = new AbortController();
  const beats: Heartbeat[] = [];
  const mailer = createMemoireMailer();
  const processor = createMailProcessor({
    queue,
    mailer,
    keys: options.keys ?? [KEY],
    publicBaseUrl: ORIGIN,
    recipients: { blockReserved: options.blockReserved ?? true, allowlist: options.allowlist ?? null },
    suspended: options.suspended ?? false,
    pollMs: 2000,
    clock: { now: () => new Date(time), sleep: async (ms) => { time += ms; } },
    heartbeat: async (beat) => { beats.push(beat); },
    signal: controller.signal,
  });
  return {
    processor, queue, mailer, calls, pending, controller, beats,
    claims: () => claims,
    purges: () => purges,
    advance: (seconds: number) => { time += seconds * 1000; },
  };
}

let output: string[] = [];

beforeEach(() => {
  output = [];
  const capture = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'info').mockImplementation(capture);
});

afterEach(() => {
  // Ni adresse ni jeton dans le journal, quel que soit le scénario.
  const all = output.join('\n');
  expect(all).not.toContain('@');
  expect(all).not.toContain(TOKEN);
  vi.restoreAllMocks();
});

describe('boucle du service mail : envoi', () => {
  it('ouvre le secret, construit le lien à fragment et clôt l’envoi', async () => {
    const row = resetRow();
    const t = setup([row]);
    expect(await t.processor.tick()).toBe('traite');
    expect(t.mailer.sent).toHaveLength(1);
    const sent = t.mailer.sent[0]!;
    expect(sent).toMatchObject({ reference: row.id, to: RECIPIENT, sendBefore: row.expiresAt });
    expect(sent.text).toContain(`${ORIGIN}/mot-de-passe/nouveau#jeton=${TOKEN}`);
    expect(t.calls).toEqual([{ op: 'sent', id: row.id }]);
    expect(output.join('\n')).toContain('courriel envoyé');
  });

  it('envoie « mot de passe modifié », qui ne porte aucun secret', async () => {
    const t = setup([changedRow()]);
    expect(await t.processor.tick()).toBe('traite');
    expect(t.mailer.sent[0]?.subject).toBe('Votre mot de passe Toron a été modifié');
  });

  it('accepte la clé précédente pendant une rotation', async () => {
    const t = setup([resetRow()], { keys: [OTHER_KEY, KEY] });
    await t.processor.tick();
    expect(t.mailer.sent).toHaveLength(1);
  });

  it('renvoie « vide » sans rien écrire quand la file est vide', async () => {
    const t = setup([]);
    expect(await t.processor.tick()).toBe('vide');
    expect(t.calls).toEqual([]);
  });
});

describe('boucle du service mail : revalidation', () => {
  it('abandonne des paramètres non conformes au type, sans envoi', async () => {
    const t = setup([changedRow({ params: {} }), resetRow({ params: { lien: 'https://ailleurs.example' } })]);
    await t.processor.tick();
    await t.processor.tick();
    expect(t.mailer.sent).toEqual([]);
    expect(t.calls.map((c) => [c.op, c.code, c.retryAt])).toEqual([
      ['failed', 'PARAMETRES_INVALIDES', null],
      ['failed', 'PARAMETRES_INVALIDES', null],
    ]);
  });

  it('abandonne un secret illisible : autre ligne, clé inconnue, secret absent ou inattendu', async () => {
    const id = randomUUID();
    const rows = [
      resetRow({ id, secretBox: seal(KEY, { id: randomUUID(), kind: 'mot_de_passe_reinitialisation' }, TOKEN) }),
      resetRow({ secretKeyId: keyId(OTHER_KEY) }),
      resetRow({ secretBox: null, secretKeyId: null }),
      changedRow({ secretBox: Buffer.alloc(40), secretKeyId: keyId(KEY) }),
    ];
    const other = randomUUID();
    rows.push(resetRow({ id: other, secretBox: seal(KEY, { id: other, kind: 'mot_de_passe_reinitialisation' }, 'jeton-mal-forme') }));
    const t = setup(rows);
    for (let i = 0; i < rows.length; i++) await t.processor.tick();
    expect(t.mailer.sent).toEqual([]);
    expect(t.calls.map((c) => c.code)).toEqual(Array(rows.length).fill('SECRET_ILLISIBLE'));
    expect(t.calls.every((c) => c.retryAt === null)).toBe(true);
  });

  it('refuse un domaine réservé avec un transport réel, sans appeler le fournisseur', async () => {
    const t = setup([resetRow({ recipient: 'camille.poirier@meridiane-logistics.example' })], { blockReserved: true });
    await t.processor.tick();
    expect(t.mailer.sent).toEqual([]);
    expect(t.calls).toMatchObject([{ op: 'failed', code: 'DESTINATAIRE_REFUSE', retryAt: null }]);
  });

  it('accepte un domaine réservé avec le transport fichier', async () => {
    const t = setup([resetRow({ recipient: 'camille.poirier@meridiane-logistics.example' })], { blockReserved: false });
    await t.processor.tick();
    expect(t.mailer.sent).toHaveLength(1);
  });

  it('applique la liste blanche du staging', async () => {
    const t = setup([resetRow(), resetRow({ recipient: 'rssi@toron.eu' })], { allowlist: ['toron.eu'] });
    await t.processor.tick();
    await t.processor.tick();
    expect(t.mailer.sent.map((e) => e.to)).toEqual(['rssi@toron.eu']);
    expect(t.calls[0]).toMatchObject({ op: 'failed', code: 'DESTINATAIRE_REFUSE' });
  });
});

describe('boucle du service mail : réponses du fournisseur', () => {
  it('programme la reprise selon les paliers, Retry-After et l’expiration', async () => {
    const rows = [
      resetRow({ attempts: 1 }),
      resetRow({ attempts: 2 }),
      resetRow({ attempts: 6 }),
      resetRow({ attempts: 1, expiresAt: new Date(NOW.getTime() + 310_000) }),
    ];
    const t = setup(rows);
    t.mailer.failWith(UNAVAILABLE, 1);
    t.mailer.failWith({ ...UNAVAILABLE, retryAfterSeconds: 600 }, 1);
    t.mailer.failWith(UNAVAILABLE, 2);
    for (let i = 0; i < rows.length; i++) await t.processor.tick();
    expect(t.calls.map((c) => c.retryAt?.toISOString() ?? null)).toEqual([
      new Date(NOW.getTime() + 30_000).toISOString(),
      new Date(NOW.getTime() + 600_000).toISOString(),
      null,
      rows[3]!.expiresAt.toISOString(),
    ]);
    expect(t.calls.every((c) => c.op === 'failed' && c.code === 'FOURNISSEUR_INDISPONIBLE')).toBe(true);
    expect(output.filter((l) => l.includes('délai dépassé — courriel expiré'))).toHaveLength(1);
  });

  it('abandonne sans reprise un refus du fournisseur', async () => {
    const t = setup([resetRow()]);
    t.mailer.failWith(REFUSED);
    await t.processor.tick();
    expect(t.calls).toMatchObject([{ op: 'failed', code: 'REFUS_FOURNISSEUR', retryAt: null }]);
    expect(t.processor.circuit().phase).toBe('ferme');
  });

  it('libère la ligne sur une erreur de configuration et ouvre le disjoncteur 5 minutes', async () => {
    const t = setup([resetRow(), resetRow()]);
    t.mailer.failWith(UNAUTHORIZED);
    await t.processor.tick();
    expect(t.calls).toMatchObject([{ op: 'release' }]);
    expect(output.join('\n')).toMatch(/mal configuré.*"code":"CONFIGURATION".*"httpStatus":401/);
    expect(await t.processor.tick()).toBe('disjoncteur');
    expect(t.claims()).toBe(1);
    t.advance(301);
    expect(await t.processor.tick()).toBe('traite');
    expect(t.processor.circuit().phase).toBe('ferme');
  });

  it('ouvre le disjoncteur après 5 pannes, sans brûler d’autre tentative, puis le referme', async () => {
    const rows = Array.from({ length: 7 }, () => resetRow());
    const t = setup(rows);
    t.mailer.failWith(UNAVAILABLE, 5);
    for (let i = 0; i < 5; i++) expect(await t.processor.tick()).toBe('traite');
    expect(t.processor.circuit().phase).toBe('ouvert');
    expect(output.join('\n')).toContain('disjoncteur ouvert');

    expect(await t.processor.tick()).toBe('disjoncteur');
    expect(t.claims()).toBe(5);
    expect(t.pending).toHaveLength(2);

    t.advance(61);
    expect(await t.processor.tick()).toBe('traite');
    expect(t.processor.circuit().phase).toBe('ferme');
    expect(output.join('\n')).toContain('disjoncteur refermé');
  });

  it('en semi-ouverture, un échec rouvre pour une durée doublée ; une file vide ne consomme pas l’essai', async () => {
    const t = setup(Array.from({ length: 5 }, () => resetRow()));
    t.mailer.failWith(UNAVAILABLE, 6);
    for (let i = 0; i < 5; i++) await t.processor.tick();
    t.advance(61);
    expect(await t.processor.tick()).toBe('vide');
    expect(t.processor.circuit().phase).toBe('ouvert');

    t.pending.push(resetRow());
    expect(await t.processor.tick()).toBe('traite');
    const circuit = t.processor.circuit();
    expect(circuit.phase).toBe('ouvert');
    expect(circuit.openUntil).toBe(NOW.getTime() + 61_000 + 120_000);
  });

  it('signale un bail perdu sans réécrire la ligne', async () => {
    const t = setup([resetRow()]);
    t.queue.markSent = async () => false;
    await t.processor.tick();
    expect(output.join('\n')).toContain('bail perdu');
  });
});

describe('boucle du service mail : arrêt', () => {
  it('SIGTERM entre la réclamation et l’envoi : la ligne est libérée, rien n’est envoyé', async () => {
    const row = resetRow();
    const t = setup([]);
    t.queue.claim = async () => { t.controller.abort(); return row; };
    await t.processor.tick();
    expect(t.mailer.sent).toEqual([]);
    expect(t.calls).toEqual([{ op: 'release', id: row.id }]);
  });

  it('SIGTERM pendant l’envoi : l’envoi se termine et se clôt, plus aucune réclamation ensuite', async () => {
    const t = setup([resetRow(), resetRow()]);
    t.mailer.onSend = () => { t.controller.abort(); };
    await t.processor.tick();
    expect(t.calls).toMatchObject([{ op: 'sent' }]);
    expect(await t.processor.tick()).toBe('vide');
    expect(t.claims()).toBe(1);
  });

  it('run s’arrête à la demande, après battement, purge et envoi', async () => {
    const t = setup([resetRow()]);
    t.queue.health = async () => [
      {
        kind: 'mot_de_passe_reinitialisation', status: 'a_envoyer', lastErrorCode: null, count: 2, countLastHour: 2,
        oldestPendingSeconds: 420,
      },
    ];
    let sleeps = 0;
    const clockSleep = async () => { sleeps++; t.controller.abort(); };
    const processor = createMailProcessor({
      queue: t.queue, mailer: t.mailer, keys: [KEY], publicBaseUrl: ORIGIN,
      recipients: { blockReserved: true, allowlist: null }, suspended: false, pollMs: 2000,
      clock: { now: () => NOW, sleep: clockSleep },
      heartbeat: async (beat) => { t.beats.push(beat); },
      signal: t.controller.signal,
    });
    await processor.run();
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.beats.map((b) => b.etat)).toEqual(['actif', 'actif']);
    expect(sleeps).toBe(1);
    const all = output.join('\n');
    expect(all).toMatch(/synthèse de la file \{"backlog":2,"echecs":0,"secondes":420\}/);
    expect(all).toContain('courriel en attente depuis plus de 5 minutes');
  });

  it('suspendu : aucune réclamation, battement « suspendu », annonce unique', async () => {
    const t = setup([resetRow()], { suspended: true });
    expect(await t.processor.tick()).toBe('suspendu');
    expect(await t.processor.tick()).toBe('suspendu');
    expect(t.claims()).toBe(0);
    expect(output.filter((l) => l.includes('envoi suspendu'))).toHaveLength(1);
  });

  it('une erreur de base est journalisée par son SQLSTATE, sans battement', async () => {
    const t = setup([]);
    t.queue.claim = async () => {
      throw Object.assign(new Error(`connexion refusée pour ${RECIPIENT}`), { code: '57P01' });
    };
    const processor = createMailProcessor({
      queue: t.queue, mailer: t.mailer, keys: [KEY], publicBaseUrl: ORIGIN,
      recipients: { blockReserved: true, allowlist: null }, suspended: false, pollMs: 2000,
      clock: { now: () => NOW, sleep: async () => { t.controller.abort(); } },
      heartbeat: async (beat) => { t.beats.push(beat); },
      signal: t.controller.signal,
    });
    await processor.run();
    expect(t.beats).toEqual([]);
    expect(output.join('\n')).toContain('erreur de base de données {"code":"SQLSTATE_57P01"}');
  });
});

describe('boucle du service mail : supervision', () => {
  /** Un passage de run() : purge et synthèse, puis arrêt à la lecture des agrégats. */
  async function summaryOnce(t: ReturnType<typeof setup>, rows: EmailOutboxHealthRow[] = []): Promise<string[]> {
    output = [];
    t.queue.health = async () => { t.controller.abort(); return rows; };
    await t.processor.run();
    return output;
  }

  function expiredRow(countLastHour: number): EmailOutboxHealthRow {
    return {
      kind: 'mot_de_passe_reinitialisation', status: 'expire', lastErrorCode: 'DELAI_DEPASSE', count: countLastHour,
      countLastHour, oldestPendingSeconds: null,
    };
  }

  it('signale les liens de réinitialisation expirés quand leur nombre sur une heure augmente', async () => {
    const t = setup([]);
    const lines = await summaryOnce(t, [expiredRow(2)]);
    expect(lines.join('\n')).toContain(
      'liens de réinitialisation expirés sans envoi sur la dernière heure {"kind":"mot_de_passe_reinitialisation","expirations":2}',
    );
  });

  it('journalise le nombre de lignes purgées dans un champ dédié', async () => {
    const t = setup([]);
    t.queue.purge = async () => 12;
    const lines = await summaryOnce(t);
    expect(lines.join('\n')).toContain('purge de la file {"purgees":12}');
  });

  it('alerte sur un disjoncteur ouvert depuis plus de 10 minutes qui bloque encore', async () => {
    const t = setup(Array.from({ length: 8 }, () => resetRow()));
    t.mailer.failWith(UNAVAILABLE, 8);
    for (let i = 0; i < 5; i++) await t.processor.tick();
    // Semi-ouvertures en échec : 60 s, puis 120 s, puis 240 s, puis 480 s d'ouverture.
    for (const wait of [61, 121, 241]) {
      t.advance(wait);
      expect(await t.processor.tick()).toBe('traite');
    }
    t.advance(200);
    expect((await summaryOnce(t)).join('\n')).toContain('disjoncteur ouvert depuis plus de 10 minutes');
  });

  it('se tait quand le délai d’ouverture est écoulé et que la file est vide', async () => {
    const t = setup(Array.from({ length: 5 }, () => resetRow()));
    t.mailer.failWith(UNAVAILABLE, 5);
    for (let i = 0; i < 5; i++) await t.processor.tick();
    t.advance(11 * 60);
    expect(t.processor.circuit().phase).toBe('ouvert');
    expect((await summaryOnce(t)).join('\n')).not.toContain('disjoncteur ouvert depuis plus de 10 minutes');
  });
});
