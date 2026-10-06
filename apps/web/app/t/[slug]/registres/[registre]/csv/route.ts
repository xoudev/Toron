import { csvFileName, toCsv } from '@toron/core';
import { withTenant, writeAuditEntry } from '@toron/db';
import { headers } from 'next/headers';
import { z } from 'zod';

import { normalizeIp } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { REGISTER_EXPORTS, REGISTER_KEYS } from '@/lib/register-exports';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Export CSV d'un registre (P5 : export total). Ouvert à tout membre, qui
// peut déjà consulter ces données à l'écran ; chaque export est tracé.

const Registre = z.enum(REGISTER_KEYS);

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; registre: string }> }): Promise<Response> {
  const { slug, registre } = await params;
  const parsed = Registre.safeParse(registre);
  if (!parsed.success) return new Response('Registre inconnu', { status: 404 });
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') return new Response('Accès refusé', { status: 403 });

  const def = REGISTER_EXPORTS[parsed.data];
  const h = await headers();
  const rows = await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    const data = await def.load(tx);
    await writeAuditEntry(tx, {
      tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'register.export', objectType: 'registre',
      after: { registre: parsed.data, lignes: data.length },
      ip: normalizeIp(h.get('x-forwarded-for')), userAgent: h.get('user-agent') || undefined,
    });
    return data;
  });

  return new Response(toCsv(def.columns, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName([def.title, slug], todayParis())}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
