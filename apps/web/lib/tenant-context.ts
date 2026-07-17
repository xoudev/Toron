import 'server-only';

import { tenantAccessVerdict, type MembershipRole } from '@toron/core';
import { schema } from '@toron/db';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';

import { auth } from './auth.ts';
import { authDb } from './db.ts';

export type TenantContext =
  | { verdict: 'non_connecte' }
  | { verdict: 'refuse' }
  | { verdict: 'totp_requis'; tenantId: string; tenantName: string }
  | {
      verdict: 'autorise';
      tenantId: string;
      tenantName: string;
      userId: string;
      userName: string;
      role: MembershipRole;
    };

/**
 * Résolution du contexte tenant (RM §5.1) : session → tenant (slug) →
 * membership, vérifiée CÔTÉ SERVEUR à chaque requête. C'est le préalable
 * obligatoire à tout withTenant() — la « vérification de l'appartenance »
 * exigée par l'ADR-3. Exécutée via le rôle toron_auth.
 */
export async function resolveTenantContext(slug: string): Promise<TenantContext> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return { verdict: 'non_connecte' };

  const db = authDb().db;
  const [tenant] = await db
    .select({ id: schema.tenants.id, name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug));
  // Tenant inconnu et non-membre produisent le même verdict : ne pas
  // révéler l'existence d'un tenant à un tiers (S1).
  if (!tenant) return { verdict: 'refuse' };

  const [membership] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.tenantId, tenant.id),
        eq(schema.memberships.userId, session.user.id),
      ),
    );

  const verdict = tenantAccessVerdict({
    membershipRole: membership?.role ?? null,
    twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
  });

  if (verdict === 'refuse') return { verdict: 'refuse' };
  if (verdict === 'totp_requis') {
    return { verdict: 'totp_requis', tenantId: tenant.id, tenantName: tenant.name };
  }
  return {
    verdict: 'autorise',
    tenantId: tenant.id,
    tenantName: tenant.name,
    userId: session.user.id,
    userName: session.user.name || session.user.email,
    role: membership!.role,
  };
}
