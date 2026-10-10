import { getExportPdf, withTenant } from '@toron/db';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

const FILE_NAME: Record<string, string> = {
  soa: 'declaration-applicabilite',
  pv: 'proces-verbal-revue-direction',
  ebios: 'livrable-ebios-rm',
  rapport: 'rapport-de-direction',
};
import { getTenantContext } from '@/lib/tenant-context-cache';

// Nom distinct par livrable : type, référentiel évalué (SoA) et date de
// scellement (heure de Paris), ex. declaration-applicabilite-iso27001-2026-10-10.pdf.
function fileName(found: { type: string; sealedAt: Date | null; frameworkCode: string | null }): string {
  const parts = [FILE_NAME[found.type] ?? 'document-scelle'];
  if (found.frameworkCode) parts.push(found.frameworkCode.replace(/[^a-z0-9_]/gi, ''));
  if (found.sealedAt) parts.push(todayParis(found.sealedAt));
  return `${parts.join('-')}.pdf`;
}

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
      'Content-Disposition': `attachment; filename="${fileName(found)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
