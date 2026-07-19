import { sql } from 'drizzle-orm';

import type { TenantTx } from '../tenant.ts';

// ── Journal d'audit consultable (§8.2, écran 14) ───────────────────────
// Lecture seule, scopée au tenant (RLS). audit_log est INSERT-only ; aucune
// API d'effacement (S6).

export interface AuditRow {
  id: string;
  at: Date;
  actorName: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  ip: string | null;
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
    SELECT a.id, a.at::text AS at, u.name AS actor_name, a.action,
           a.object_type, a.object_id, host(a.ip) AS ip
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ${prefix ? sql`WHERE a.action LIKE ${prefix + '%'}` : sql``}
    ORDER BY a.at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return (
    rows as unknown as {
      id: string;
      at: string;
      actor_name: string | null;
      action: string;
      object_type: string;
      object_id: string | null;
      ip: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    at: new Date(r.at),
    actorName: r.actor_name,
    action: r.action,
    objectType: r.object_type,
    objectId: r.object_id,
    ip: r.ip,
  }));
}
