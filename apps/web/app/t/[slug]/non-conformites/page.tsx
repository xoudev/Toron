import { canManageControls } from '@toron/core';
import { listNc, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { appDb } from '@/lib/db';
import { ModuleDisabled } from '@/components/module-disabled';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { NcBoard } from './nc-board';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Non-conformités — Toron' };

export default async function NonConformitesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  if (!(await getOrganisationOverview(ctx.tenantId)).enabled('non_conformites')) return <ModuleDisabled slug={slug} module="non_conformites" role={ctx.role} />;
  const canManage = canManageControls(ctx.role);

  const ncs = await withTenant(appDb().db, ctx.tenantId, (tx) => listNc(tx));
  const toVerify = ncs.filter((n) => n.effectivenessDue).length;

  return (
    <>
      <Topbar
        crumbRoot="Qualité"
        crumbCurrent="Non-conformités"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>PACK QMS</span><ExportCsvLink slug={slug} registre="non-conformites" />
            <ThemeToggle /></>}
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
