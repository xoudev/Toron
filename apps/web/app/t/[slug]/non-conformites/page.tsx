import { canManageControls } from '@toron/core';
import { listNc, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { NcBoard } from './nc-board';

export const dynamic = 'force-dynamic';

export default async function NonConformitesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const ncs = await withTenant(appDb().db, ctx.tenantId, (tx) => listNc(tx));
  const toVerify = ncs.filter((n) => n.effectivenessDue).length;

  return (
    <>
      <Topbar
        crumbRoot="Qualité"
        crumbCurrent="Non-conformités"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>PACK QMS</span><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Non-conformités</h1>
            <p className="sub">
              Analyse de cause racine (5 pourquoi), actions correctives dans le plan d’action commun,
              et vérification d’efficacité planifiée à J+90 après la clôture.
            </p>
          </div>
        </div>
        {toVerify > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p><b>{toVerify} vérification{toVerify > 1 ? 's' : ''} d’efficacité échue{toVerify > 1 ? 's' : ''}</b> — confirmez l’efficacité ou rouvrez la NC.</p>
          </div>
        ) : null}
        <NcBoard slug={slug} canManage={canManage} ncs={ncs} />
      </main>
    </>
  );
}
