import { getVersionContent, withTenant } from '@toron/db';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Téléchargement du contenu d'une version documentaire : réservé aux membres
// du tenant (tout rôle — consulter un document publié est autorisé), via
// withTenant (RLS). Nom de fichier assaini pour l'en-tête Content-Disposition.
function safeFilename(name: string | null): string {
  const base = (name ?? 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return base.length > 0 ? base : 'document';
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
): Promise<Response> {
  const { slug, versionId } = await params;
  if (!z.uuid().safeParse(versionId).success) {
    return new Response('Référence invalide', { status: 400 });
  }
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') {
    return new Response('Accès refusé', { status: 403 });
  }
  const found = await withTenant(appDb().db, ctx.tenantId, (tx) => getVersionContent(tx, versionId));
  if (!found) {
    return new Response('Version introuvable ou sans contenu', { status: 404 });
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
