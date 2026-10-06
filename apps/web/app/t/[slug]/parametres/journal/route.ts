import { listAuditLog, withTenant } from '@toron/db';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Export CSV du journal d'audit (§8.2 : consultable, filtrable, exportable).
// Lecture réservée aux membres de l'organisation ; même filtre que l'écran.

const MAX_ROWS = 20_000;
const PAGE = 200;

function csvCell(v: string | null | undefined): string {
  const s = v ?? '';
  // Neutralise les formules de tableur et échappe les guillemets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') return new Response('Accès refusé', { status: 403 });

  const url = new URL(req.url);
  const filtre = (url.searchParams.get('filtre') ?? '').slice(0, 40);
  if (!/^[a-z_.]*$/.test(filtre)) return new Response('Filtre invalide', { status: 400 });

  const lines = ['﻿"horodatage";"acteur";"action";"type_objet";"id_objet";"ip"'];
  await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const rows = await listAuditLog(tx, { limit: PAGE, offset, actionPrefix: filtre || undefined });
      for (const r of rows) {
        lines.push([csvCell(r.at.toISOString()), csvCell(r.actorName), csvCell(r.action), csvCell(r.objectType), csvCell(r.objectId), csvCell(r.ip)].join(';'));
      }
      if (rows.length < PAGE) break;
    }
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="journal-audit-${slug}-${stamp}.csv"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
