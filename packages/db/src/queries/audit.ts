import { sql } from 'drizzle-orm';

import type { TenantTx } from '../tenant.ts';

// ── Journal d'audit consultable (§8.2, écran 14) ───────────────────────
// Lecture seule, scopée au tenant (RLS). audit_log est INSERT-only ; aucune
// API d'effacement (S6).

export interface AuditRow {
  id: string;
  /** Numéro d'ordre de l'entrée dans l'organisation, et son empreinte chaînée. */
  seq: number;
  prevHash: string;
  hash: string;
  at: Date;
  actorName: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  ip: string | null;
}

/** Nombre total d'entrées correspondant au filtre, pour la pagination. */
export async function countAuditLog(tx: TenantTx, opts: { actionPrefix?: string } = {}): Promise<number> {
  const prefix = opts.actionPrefix?.trim();
  const rows = await tx.execute(sql`
    SELECT count(*)::integer AS n FROM audit_log a
    ${prefix ? sql`WHERE a.action LIKE ${prefix + '%'}` : sql``}
  `);
  return (rows as unknown as { n: number }[])[0]?.n ?? 0;
}

/**
 * Entrées du journal d'audit du tenant, les plus récentes d'abord, paginées.
 * Filtre optionnel par préfixe d'action (ex. « risk. », « incident. »).
 */
export async function listAuditLog(
  tx: TenantTx,
  opts: { limit?: number; offset?: number; actionPrefix?: string } = {},
): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const prefix = opts.actionPrefix?.trim();
  const rows = await tx.execute(sql`
    SELECT a.id, a.seq, a.prev_hash, a.hash, a.at::text AS at, u.name AS actor_name, a.action,
           a.object_type, a.object_id, host(a.ip) AS ip
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ${prefix ? sql`WHERE a.action LIKE ${prefix + '%'}` : sql``}
    ORDER BY a.seq DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return (
    rows as unknown as {
      id: string;
      seq: number | string;
      prev_hash: string;
      hash: string;
      at: string;
      actor_name: string | null;
      action: string;
      object_type: string;
      object_id: string | null;
      ip: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    prevHash: r.prev_hash,
    hash: r.hash,
    at: new Date(r.at),
    actorName: r.actor_name,
    action: r.action,
    objectType: r.object_type,
    objectId: r.object_id,
    ip: r.ip,
  }));
}

export interface AuditChainStatus {
  /** Entrées présentes, et numéro de la dernière. */
  entries: number;
  lastSeq: number;
  /** Tête de chaîne tenue par la base, hors de portée de l'application. */
  headSeq: number;
  headHash: string | null;
  /** Première entrée dont le chaînage ne se vérifie pas, ou null. */
  brokenAtSeq: number | null;
  intact: boolean;
}

/**
 * Vérifie le chaînage du journal de l'organisation courante : chaque
 * empreinte est recalculée, chaque entrée doit suivre la précédente sans
 * trou, et la dernière doit correspondre à la tête de chaîne (une
 * suppression des dernières entrées se voit donc aussi).
 */
export async function verifyAuditChain(tx: TenantTx): Promise<AuditChainStatus> {
  const [row] = (await tx.execute(sql`
    WITH ordered AS (
      SELECT seq, prev_hash, hash,
             audit_log_entry_hash(prev_hash, seq, tenant_id, at, actor_user_id, action, object_type, object_id,
                                  before, after, ip, user_agent) AS expected,
             lag(hash) OVER (ORDER BY seq) AS previous,
             row_number() OVER (ORDER BY seq) AS position
      FROM audit_log
    )
    SELECT count(*)::int AS entries,
           coalesce(max(seq), 0)::bigint AS last_seq,
           (SELECT o.hash FROM ordered o ORDER BY o.seq DESC LIMIT 1) AS last_hash,
           min(seq) FILTER (
             WHERE hash <> expected OR seq <> position OR prev_hash <> coalesce(previous, repeat('0', 64))
           )::bigint AS broken_at,
           (SELECT h.seq FROM audit_chain_head() h) AS head_seq,
           (SELECT h.hash FROM audit_chain_head() h) AS head_hash
    FROM ordered
  `)) as unknown as {
    entries: number; last_seq: number | string; last_hash: string | null; broken_at: number | string | null;
    head_seq: number | string | null; head_hash: string | null;
  }[];
  const entries = row?.entries ?? 0;
  const lastSeq = Number(row?.last_seq ?? 0);
  const headSeq = Number(row?.head_seq ?? 0);
  const headHash = row?.head_hash ?? null;
  let brokenAtSeq = row?.broken_at == null ? null : Number(row.broken_at);
  // Dernières entrées effacées : la tête de chaîne en annonce davantage.
  if (brokenAtSeq === null && (headSeq !== lastSeq || (lastSeq > 0 && headHash !== row?.last_hash))) {
    brokenAtSeq = Math.min(lastSeq, headSeq) + 1;
  }
  return { entries, lastSeq, headSeq, headHash, brokenAtSeq, intact: brokenAtSeq === null };
}

/** Tête de chaîne de l'organisation courante (dernier numéro, dernière empreinte), sans recalcul. */
export async function getAuditChainHead(tx: TenantTx): Promise<{ seq: number; hash: string } | null> {
  const [row] = (await tx.execute(sql`SELECT seq, hash FROM audit_chain_head()`)) as unknown as { seq: number | string; hash: string }[];
  return row ? { seq: Number(row.seq), hash: row.hash } : null;
}
