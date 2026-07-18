import { getEvidenceContent, logAccess, withTenant } from '@toron/db';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Téléchargement d'une preuve : réservé aux membres du tenant (tout rôle),
// via withTenant (RLS). Chaque téléchargement est JOURNALISÉ (RM §5.7 :
// journal des accès). Nom de fichier assaini pour l'en-tête.
function safeFilename(name: string | null): string {
  const base = (name ?? 'preuve').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return base.length > 0 ? base : 'preuve';
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; evidenceId: string }> },
): Promise<Response> {
  const { slug, evidenceId } = await params;
  if (!z.uuid().safeParse(evidenceId).success) {
    return new Response('Référence invalide', { status: 400 });
  }
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') {
    return new Response('Accès refusé', { status: 403 });
  }
  const found = await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    const content = await getEvidenceContent(tx, evidenceId);
    if (content) {
      await logAccess(tx, {
        tenantId: ctx.tenantId,
        evidenceId,
        userId: ctx.userId,
        kind: 'telechargement',
      });
    }
    return content;
  });
  if (!found) {
    return new Response('Preuve introuvable ou sans contenu', { status: 404 });
  }
  return new Response(new Uint8Array(found.content), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilename(found.fileName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
