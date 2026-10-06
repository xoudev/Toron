import { canConfigureOrganisation } from '@toron/core';
import { exportTenantData, withTenant, writeAuditEntry } from '@toron/db';
import { headers } from 'next/headers';

import { normalizeIp } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Export complet des données de l'organisation (P5 : import facile, export
// total). Réservé aux rôles qui configurent l'organisation ; tracé au journal.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') return new Response('Accès refusé', { status: 403 });
  if (!canConfigureOrganisation(ctx.role)) {
    return new Response('L’export complet est réservé au propriétaire, à la direction, au RSSI et au responsable qualité.', { status: 403 });
  }

  const h = await headers();
  const data = await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    const payload = await exportTenantData(tx);
    await writeAuditEntry(tx, {
      tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'tenant.export', objectType: 'organisation',
      objectId: ctx.tenantId, after: { tables: Object.keys(payload.counts).length, rows: Object.values(payload.counts).reduce((a, b) => a + b, 0) },
      ip: normalizeIp(h.get('x-forwarded-for')), userAgent: h.get('user-agent') || undefined,
    });
    return payload;
  });

  const stamp = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify({ organisation: { slug, name: ctx.tenantName }, ...data }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="toron-${slug}-${stamp}.json"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
