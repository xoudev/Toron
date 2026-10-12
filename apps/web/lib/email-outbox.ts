import 'server-only';

import { deriveOutboxKey, keyId, seal, type SealContext } from '@toron/mail';

import { env } from './env.ts';

// Côté web de la file d'e-mails : scellement des secrets avant dépôt et
// journal à champs fermés. Le web ne détient que la clé de scellement ;
// l'envoi (et la clé du fournisseur) reste au service mail.

export interface SealedSecret {
  box: Buffer;
  keyId: string;
}

export interface OutboxSealer {
  seal(context: SealContext, plaintext: string): SealedSecret;
}

export function createOutboxSealer(secret: string): OutboxSealer {
  const key = deriveOutboxKey(secret);
  const id = keyId(key);
  return { seal: (context, plaintext) => ({ box: seal(key, context, plaintext), keyId: id }) };
}

let sealer: OutboxSealer | null | undefined;

/**
 * Scelleur de l'application, ou null si MAIL_OUTBOX_KEY est absente (local
 * uniquement : env() l'exige ailleurs). Dans ce cas aucun e-mail n'est
 * déposé, et un seul avertissement le signale.
 */
export function outboxSealer(): OutboxSealer | null {
  if (sealer === undefined) {
    const secret = env().MAIL_OUTBOX_KEY;
    sealer = secret ? createOutboxSealer(secret) : null;
    if (!sealer) logAccountEmail('envoi_desactive', {});
  }
  return sealer;
}

const EVENTS = {
  envoi_desactive: { level: 'warn', text: 'envoi d’e-mails désactivé — MAIL_OUTBOX_KEY absente, aucun lien ne sera envoyé' },
  reinit_depose: { level: 'warn', text: 'réinitialisation · e-mail mis en file' },
  reinit_remplace: { level: 'warn', text: 'réinitialisation · demande remplacée par une plus récente' },
  reinit_quota_compte: { level: 'warn', text: 'réinitialisation · quota du compte atteint, jeton supprimé' },
  reinit_quota_global: { level: 'error', text: 'réinitialisation · plafond global de la file atteint, jeton supprimé' },
  reinit_jeton_inattendu: { level: 'error', text: 'réinitialisation · jeton de forme inattendue, rien n’est déposé' },
  reinit_echec: { level: 'error', text: 'réinitialisation · dépôt impossible' },
  modifie_purge_echec: { level: 'error', text: 'mot de passe modifié · purge des jetons et sessions impossible' },
  modifie_audit_ecrit: { level: 'warn', text: 'mot de passe modifié · journal d’audit écrit' },
  modifie_audit_echec: { level: 'error', text: 'mot de passe modifié · journal d’audit non écrit' },
  modifie_depose: { level: 'warn', text: 'mot de passe modifié · avis mis en file' },
  modifie_quota_compte: { level: 'warn', text: 'mot de passe modifié · quota du compte atteint, avis non déposé' },
  modifie_quota_global: { level: 'error', text: 'mot de passe modifié · plafond global de la file atteint, avis non déposé' },
  modifie_echec: { level: 'error', text: 'mot de passe modifié · dépôt de l’avis impossible' },
} as const satisfies Record<string, { level: 'warn' | 'error'; text: string }>;

export type AccountEmailEvent = keyof typeof EVENTS;

export interface AccountEmailLogFields {
  correlationId?: string;
  /** SQLSTATE, ou INCONNU : jamais le message d'erreur, qui peut citer une valeur. */
  code?: string;
  /** Nombre d'organisations dont le journal a reçu l'entrée. */
  organisations?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9_]{2,40}$/;

/** Journal sans adresse ni jeton : seuls des champs de forme connue sont écrits. */
export function logAccountEmail(event: AccountEmailEvent, fields: AccountEmailLogFields): void {
  const { level, text } = EVENTS[event];
  const out: Record<string, string | number> = {};
  if (fields.correlationId !== undefined && UUID.test(fields.correlationId)) out.correlationId = fields.correlationId;
  if (fields.code !== undefined) out.code = CODE.test(fields.code) ? fields.code : 'INCONNU';
  if (fields.organisations !== undefined && Number.isInteger(fields.organisations)) out.organisations = fields.organisations;
  (level === 'error' ? console.error : console.warn)('[courriel]', text, out);
}

/** SQLSTATE d'une erreur Postgres, éventuellement enveloppée par Drizzle, sinon INCONNU. */
export function errorCode(err: unknown): string {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 4; e = (e as { cause?: unknown }).cause, depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return 'INCONNU';
}
