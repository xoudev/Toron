import type { MembershipRole } from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Membres du tenant courant ───────────────────────────────────────────
// Alimente les sélecteurs de propriétaire / d'assigné (risques, actions…)
// et l'administration des accès (écran 14). RLS active : memberships est
// filtré sur le tenant courant, users n'est visible que pour ses membres.

export interface TenantMember {
  userId: string;
  name: string;
  role: string;
}

export interface TenantMemberDetail {
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  twoFactorEnabled: boolean;
  memberSince: Date;
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

/** Vue administration : adresse, double authentification, ancienneté. */
export async function listTenantMemberDetails(tx: TenantTx): Promise<TenantMemberDetail[]> {
  const rows = await tx.select({
    userId: schema.users.id, name: schema.users.name, email: schema.users.email,
    role: schema.memberships.role, twoFactorEnabled: schema.users.twoFactorEnabled,
    memberSince: schema.memberships.createdAt,
  }).from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .orderBy(schema.users.name);
  return rows.map((r) => ({ ...r, role: r.role as MembershipRole }));
}

export async function getMembership(tx: TenantTx, userId: string): Promise<{ role: MembershipRole } | null> {
  const [row] = await tx.select({ role: schema.memberships.role }).from(schema.memberships)
    .where(eq(schema.memberships.userId, userId));
  return row ? { role: row.role as MembershipRole } : null;
}

export async function countOwners(tx: TenantTx): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::integer` }).from(schema.memberships)
    .where(eq(schema.memberships.role, 'owner'));
  return row?.n ?? 0;
}

export async function updateMemberRole(tx: TenantTx, input: { tenantId: string; userId: string; role: MembershipRole }): Promise<boolean> {
  const rows = await tx.update(schema.memberships).set({ role: input.role })
    .where(and(eq(schema.memberships.tenantId, input.tenantId), eq(schema.memberships.userId, input.userId)))
    .returning({ id: schema.memberships.id });
  return rows.length > 0;
}

export async function removeMember(tx: TenantTx, input: { tenantId: string; userId: string }): Promise<boolean> {
  const rows = await tx.delete(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, input.tenantId), eq(schema.memberships.userId, input.userId)))
    .returning({ id: schema.memberships.id });
  return rows.length > 0;
}
