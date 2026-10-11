import { sql } from 'drizzle-orm';

import type { Db } from '../client.ts';

// ── File d'envoi des e-mails (migration 0041) ──────────────────────────
// SQL brut sur les fonctions SECURITY DEFINER de la file : la table
// email_outbox n'a volontairement pas de déclaration Drizzle, pour rester
// hors de exportTenantData. Aucune de ces fonctions ne passe par
// withTenant : les e-mails de compte n'appartiennent à aucune organisation
// (tenant_id NULL), et le service mail travaille sans contexte tenant.

/** Client ou transaction : le dépôt peut rejoindre une transaction de l'appelant. */
type SqlExecutor = Pick<Db, 'execute'>;

export const ACCOUNT_EMAIL_KINDS = ['mot_de_passe_reinitialisation', 'mot_de_passe_modifie'] as const;
export type AccountEmailKind = (typeof ACCOUNT_EMAIL_KINDS)[number];

export const ENQUEUE_EMAIL_RESULTS = ['mis_en_file', 'quota_compte', 'quota_global'] as const;
export type EnqueueEmailResult = (typeof ENQUEUE_EMAIL_RESULTS)[number];

export const EMAIL_OUTBOX_STATUSES = ['a_envoyer', 'en_cours', 'envoye', 'echec', 'expire'] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

function oneOf<T extends string>(values: readonly T[], value: unknown, what: string): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new Error(`File d'envoi : ${what} inattendu renvoyé par la base. Vérifiez que la migration 0041 est appliquée.`);
}

export interface EnqueueAccountEmailInput {
  /** Identifiant de la ligne, choisi par l'appelant : il entre dans l'AAD du scellement. */
  id: string;
  kind: AccountEmailKind;
  userId: string;
  /** Adresse déjà normalisée en minuscules (contrainte de la table). */
  recipient: string;
  params: Record<string, string | number | boolean>;
  secretBox: Uint8Array | null;
  secretKeyId: string | null;
  expiresAt: Date;
  correlationId: string;
}

/**
 * Dépose un e-mail de compte. Réservé au rôle toron_auth ; la base impose
 * tenant_id NULL et applique les quotas par compte et le plafond global.
 */
export async function enqueueAccountEmail(db: SqlExecutor, input: EnqueueAccountEmailInput): Promise<EnqueueEmailResult> {
  const box = input.secretBox === null ? null : Buffer.from(input.secretBox);
  const [row] = (await db.execute(sql`
    SELECT enqueue_account_email(
      ${input.id}::uuid, ${input.kind}, ${input.userId}::uuid, ${input.recipient}, ${JSON.stringify(input.params)}::jsonb,
      ${box}::bytea, ${input.secretKeyId}, ${input.expiresAt.toISOString()}::timestamptz, ${input.correlationId}::uuid
    ) AS result
  `)) as unknown as { result: string }[];
  return oneOf(ENQUEUE_EMAIL_RESULTS, row?.result, 'résultat de dépôt');
}

export interface ClaimEmailOptions {
  leaseSeconds: number;
  minMarginSeconds: number;
  maxAttempts: number;
}

export interface ClaimedEmail {
  id: string;
  kind: AccountEmailKind;
  recipient: string;
  params: Record<string, unknown>;
  secretBox: Buffer | null;
  secretKeyId: string | null;
  /** Tentatives consommées, celle-ci comprise. */
  attempts: number;
  expiresAt: Date;
  leaseToken: string;
  correlationId: string;
}

/** Réclame le prochain e-mail dû (rôle toron_mail), ou null si la file est vide. */
export async function claimNextEmail(db: SqlExecutor, options: ClaimEmailOptions): Promise<ClaimedEmail | null> {
  const [row] = (await db.execute(sql`
    SELECT id, kind, recipient, params, secret_box, secret_key_id, attempts, expires_at, lease_token, correlation_id
      FROM claim_next_email(
        make_interval(secs => ${options.leaseSeconds}::double precision),
        make_interval(secs => ${options.minMarginSeconds}::double precision),
        ${options.maxAttempts}::integer)
  `)) as unknown as {
    id: string; kind: string; recipient: string; params: Record<string, unknown>; secret_box: Buffer | null;
    secret_key_id: string | null; attempts: number; expires_at: Date | string; lease_token: string; correlation_id: string;
  }[];
  if (!row) return null;
  return {
    id: row.id,
    kind: oneOf(ACCOUNT_EMAIL_KINDS, row.kind, 'type d’e-mail'),
    recipient: row.recipient,
    params: row.params,
    secretBox: row.secret_box,
    secretKeyId: row.secret_key_id,
    attempts: Number(row.attempts),
    expiresAt: new Date(row.expires_at),
    leaseToken: row.lease_token,
    correlationId: row.correlation_id,
  };
}

/** Clôt un envoi accepté par le fournisseur. false : le bail n'est plus le bon. */
export async function markEmailSent(db: SqlExecutor, id: string, leaseToken: string, providerMessageId: string | null): Promise<boolean> {
  const [row] = (await db.execute(sql`
    SELECT mark_email_sent(${id}::uuid, ${leaseToken}::uuid, ${providerMessageId}) AS done
  `)) as unknown as { done: boolean }[];
  return row?.done === true;
}

/**
 * Enregistre un échec. Sans date de reprise, l'échec est définitif ; une
 * reprise à l'expiration ou au-delà fait expirer la ligne (DELAI_DEPASSE).
 * Renvoie le nouveau statut, ou null si le bail n'est plus le bon.
 */
export async function markEmailFailed(
  db: SqlExecutor,
  id: string,
  leaseToken: string,
  code: string,
  retryAt: Date | null,
): Promise<'a_envoyer' | 'echec' | 'expire' | null> {
  const [row] = (await db.execute(sql`
    SELECT mark_email_failed(${id}::uuid, ${leaseToken}::uuid, ${code}, ${retryAt === null ? null : retryAt.toISOString()}::timestamptz) AS status
  `)) as unknown as { status: string | null }[];
  if (row?.status == null) return null;
  return oneOf(['a_envoyer', 'echec', 'expire'] as const, row.status, 'statut de clôture');
}

/** Rend la ligne à la file sans consommer de tentative. false : le bail n'est plus le bon. */
export async function releaseEmail(db: SqlExecutor, id: string, leaseToken: string): Promise<boolean> {
  const [row] = (await db.execute(sql`
    SELECT release_email(${id}::uuid, ${leaseToken}::uuid) AS done
  `)) as unknown as { done: boolean }[];
  return row?.done === true;
}

/** Supprime les lignes finales plus anciennes que la rétention (7 jours au minimum). */
export async function purgeEmailOutbox(db: SqlExecutor, retentionDays: number): Promise<number> {
  const [row] = (await db.execute(sql`
    SELECT purge_email_outbox(make_interval(days => ${retentionDays}::integer)) AS purged
  `)) as unknown as { purged: number }[];
  return Number(row?.purged ?? 0);
}

export interface EmailOutboxHealthRow {
  kind: AccountEmailKind;
  status: EmailOutboxStatus;
  lastErrorCode: string | null;
  count: number;
  /** Lignes passées à ce statut dans la dernière heure. */
  countLastHour: number;
  /** Âge de la plus ancienne ligne en attente, pour les statuts a_envoyer et en_cours. */
  oldestPendingSeconds: number | null;
}

/** Agrégats de la file sur 24 heures, sans adresse ni contenu. */
export async function emailOutboxHealth(db: SqlExecutor): Promise<EmailOutboxHealthRow[]> {
  const rows = (await db.execute(sql`
    SELECT kind, status, last_error_code, n, n_last_hour, oldest_pending_seconds FROM email_outbox_health()
  `)) as unknown as {
    kind: string; status: string; last_error_code: string | null; n: number; n_last_hour: number;
    oldest_pending_seconds: number | null;
  }[];
  return rows.map((r) => ({
    kind: oneOf(ACCOUNT_EMAIL_KINDS, r.kind, 'type d’e-mail'),
    status: oneOf(EMAIL_OUTBOX_STATUSES, r.status, 'statut'),
    lastErrorCode: r.last_error_code,
    count: Number(r.n),
    countLastHour: Number(r.n_last_hour),
    oldestPendingSeconds: r.oldest_pending_seconds === null ? null : Number(r.oldest_pending_seconds),
  }));
}
