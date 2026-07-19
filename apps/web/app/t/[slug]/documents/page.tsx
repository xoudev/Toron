import { canManageControls } from '@toron/core';
import { listDocuments, listProcesses, listScopes, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { DocumentsBoard } from './documents-board';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { documents, scopes, members, processes } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    documents: await listDocuments(tx),
    scopes: await listScopes(tx),
    members: await listTenantMembers(tx),
    processes: (await listProcesses(tx)).map((p) => ({ id: p.id, name: p.name })),
  }));

  const late = documents.filter((d) => d.reviewOverdue).length;

  return (
    <>
      <Topbar
        crumbRoot="Système de management"
        crumbCurrent="Documents"
        actions={
          <>
            <span className="topbar-crumb" style={{ marginRight: 4 }}>
              {documents.length} DOCUMENT{documents.length > 1 ? 'S' : ''}
            </span>
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Documents</h1>
            <p className="sub">
              Documents versionnés — une version publiée est immuable. La date de revue déclenche une
              alerte ; les exigences couvertes apparaissent dans la Déclaration d’applicabilité.
            </p>
          </div>
        </div>

        {late > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p>
              <b>{late} document{late > 1 ? 's' : ''} à revoir</b> — date de revue dépassée.
            </p>
          </div>
        ) : null}

        <DocumentsBoard slug={slug} canManage={canManage} documents={documents} scopes={scopes} members={members} processes={processes} />
      </main>
    </>
  );
}
