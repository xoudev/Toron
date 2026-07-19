import { canManageControls, documentTemplate, nextSemver } from '@toron/core';
import { getVersionBody, latestSemver, listDocuments, listVersions, withTenant } from '@toron/db';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { DocumentEditor } from './document-editor';

export const dynamic = 'force-dynamic';

export default async function DocumentEditorPage({ params }: { params: Promise<{ slug: string; documentId: string }> }) {
  const { slug, documentId } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  if (!canManageControls(ctx.role)) redirect(`/t/${slug}/documents`);

  const data = await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    const doc = (await listDocuments(tx)).find((d) => d.id === documentId);
    if (!doc) return null;
    const versions = await listVersions(tx, documentId);
    const latestBodyVersion = versions.find((v) => v.hasBody) ?? null;
    const body = latestBodyVersion ? await getVersionBody(tx, latestBodyVersion.id) : null;
    return { doc, body, next: nextSemver(await latestSemver(tx, documentId)) };
  });
  if (!data) redirect(`/t/${slug}/documents`);

  const initial = data.body ?? documentTemplate(data.doc.type);
  const entityMeta = `${ctx.tenantName} · ${data.doc.type.replace('_', '/').toUpperCase()}`;

  return (
    <DocumentEditor
      slug={slug}
      documentId={documentId}
      title={data.doc.title}
      docType={data.doc.type}
      processName={data.doc.processName}
      initialBody={initial}
      nextSemver={data.next}
      entityMeta={entityMeta}
    />
  );
}
