import { getExportPdf, withTenant } from '@toron/db';
import { z } from 'zod';

import { appDb } from '@/lib/db';

const FILE_NAME: Record<string, string> = {
  soa: 'declaration-applicabilite.pdf',
  pv: 'proces-verbal-revue-direction.pdf',
  ebios: 'livrable-ebios-rm.pdf',
  rapport: 'rapport-de-direction.pdf',
};
import { getTenantContext } from '@/lib/tenant-context-cache';

// Téléchargement du PDF scellé : lecture réservée aux membres du tenant
// (tout rôle — consulter un livrable est autorisé), via withTenant (RLS).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; exportId: string }> },
): Promise<Response> {
  const { slug, exportId } = await params;
  if (!z.uuid().safeParse(exportId).success) {
    return new Response('Référence invalide', { status: 400 });
  }
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') {
    return new Response('Accès refusé', { status: 403 });
  }
  const found = await withTenant(appDb().db, ctx.tenantId, (tx) => getExportPdf(tx, exportId));
  if (!found) {
    return new Response('Document introuvable ou non encore scellé', { status: 404 });
  }
  return new Response(new Uint8Array(found.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${FILE_NAME[found.type] ?? 'document-scelle.pdf'}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
