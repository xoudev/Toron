import { SEARCH_KIND_META, parseSearchQuery, refCodeFor } from '@toron/core';
import { searchTenant, withTenant } from '@toron/db';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Recherche transverse pour la palette Ctrl+K : lecture seule, réservée aux
// membres de l'organisation, résultats bornés et jamais mis en cache.

export interface SearchResult {
  kind: string;
  label: string;
  code: string | null;
  title: string;
  detail: string | null;
  href: string;
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') return Response.json({ results: [] }, { status: 403 });

  const raw = new URL(req.url).searchParams.get('q') ?? '';
  const query = parseSearchQuery(raw.slice(0, 200));
  const hits = await withTenant(appDb().db, ctx.tenantId, (tx) => searchTenant(tx, query));
  const base = `/t/${slug}`;

  const results: SearchResult[] = hits.map((h) => {
    const meta = SEARCH_KIND_META[h.kind];
    const href = h.kind === 'exigence' && h.parentId
      ? `${base}/referentiels/${h.parentId}`
      : h.kind === 'controle'
        ? `${base}${meta.path}`
        : `${base}${meta.path}?ouvrir=${h.id}`;
    return { kind: h.kind, label: meta.label, code: refCodeFor(h.kind, h.id), title: h.title, detail: h.detail, href };
  });

  return Response.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } });
}
