import { sql } from 'drizzle-orm';

import type { TenantTx } from '../tenant.ts';

// ── Membres du tenant courant ───────────────────────────────────────────
// Alimente les sélecteurs de propriétaire / d'assigné (risques, actions…).
// RLS active : memberships est filtré sur le tenant courant, users n'est
// visible que pour ses membres.

export interface TenantMember {
  userId: string;
  name: string;
  role: string;
}

/** Membres du tenant courant, triés par nom. */
export async function listTenantMembers(tx: TenantTx): Promise<TenantMember[]> {
  const rows = await tx.execute(sql`
    SELECT u.id AS user_id, u.name, m.role
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    ORDER BY u.name
  `);
  return (rows as unknown as { user_id: string; name: string; role: string }[]).map((r) => ({
    userId: r.user_id,
    name: r.name,
    role: r.role,
  }));
}
