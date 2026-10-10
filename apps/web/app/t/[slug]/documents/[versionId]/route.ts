import { attachmentDisposition, canManageControls } from '@toron/core';
import { getVersionContent, withTenant } from '@toron/db';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Téléchargement du contenu d'une version documentaire : tout membre peut
// télécharger une version publiée ; un brouillon reste réservé aux rôles qui
// gèrent la documentation. Lecture via withTenant (RLS). Nom de fichier
// assaini pour l'en-tête Content-Disposition, accents gardés.

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
  const found = await withTenant(appDb().db, ctx.tenantId, (tx) => getVersionContent(tx, versionId, { publishedOnly: !canManageControls(ctx.role) }));
  if (!found) {
    return new Response('Version introuvable ou sans contenu', { status: 404 });
  }
  return new Response(new Uint8Array(found.content), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': attachmentDisposition(found.fileName, 'document'),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
