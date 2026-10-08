import { csvFileName, toCsv, type CsvColumn } from '@toron/core';
import { listAuditLog, withTenant, type AuditRow } from '@toron/db';

import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Export CSV du journal d'audit (§8.2 : consultable, filtrable, exportable).
// Lecture réservée aux membres de l'organisation ; même filtre que l'écran.

const MAX_ROWS = 20_000;
const PAGE = 200;

// Numéro et empreintes : un auditeur qui conserve un export peut constater
// plus tard que les entrées déjà exportées n'ont pas changé.
const COLUMNS: CsvColumn<AuditRow>[] = [
  { header: 'numero', value: (r) => r.seq },
  { header: 'horodatage', value: (r) => r.at },
  { header: 'acteur', value: (r) => r.actorName },
  { header: 'action', value: (r) => r.action },
  { header: 'type_objet', value: (r) => r.objectType },
  { header: 'id_objet', value: (r) => r.objectId },
  { header: 'ip', value: (r) => r.ip },
  { header: 'empreinte_precedente', value: (r) => r.prevHash },
  { header: 'empreinte', value: (r) => r.hash },
];

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') return new Response('Accès refusé', { status: 403 });

  const url = new URL(req.url);
  const filtre = (url.searchParams.get('filtre') ?? '').slice(0, 40);
  if (!/^[a-z_.]*$/.test(filtre)) return new Response('Filtre invalide', { status: 400 });

  const rows: AuditRow[] = [];
  await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const page = await listAuditLog(tx, { limit: PAGE, offset, actionPrefix: filtre || undefined });
      rows.push(...page);
      if (page.length < PAGE) break;
    }
  });

  return new Response(toCsv(COLUMNS, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName(['journal-audit', slug], todayParis())}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
