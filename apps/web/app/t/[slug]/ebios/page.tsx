import { canManageControls, defaultRiskScale } from '@toron/core';
import { getActiveScale, listScopes, listStudies, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { ModuleDisabled } from '@/components/module-disabled';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { EbiosBoard } from './ebios-board';

export const dynamic = 'force-dynamic';

export default async function EbiosPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  if (!(await getOrganisationOverview(ctx.tenantId)).enabled('ebios')) return <ModuleDisabled slug={slug} module="ebios" role={ctx.role} />;
  const canManage = canManageControls(ctx.role);

  const { studies, scopes, scale } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    studies: await listStudies(tx),
    scopes: await listScopes(tx),
    // Libellés de gravité proposés à l'atelier 5 (échelle par défaut tant
    // qu'aucune n'est posée : la génération du risque la pose à l'identique).
    scale: (await getActiveScale(tx))?.scale ?? defaultRiskScale(),
  }));

  return (
    <>
      <Topbar
        crumbRoot="Risques"
        crumbCurrent="Atelier EBIOS RM"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>MÉTHODE ANSSI</span><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Atelier EBIOS RM</h1>
            <p className="sub">
              Cinq ateliers guidés (méthode ANSSI). L’atelier 4 construit chaque scénario
              opérationnel en kill chain « Connaître → Rentrer → Trouver → Exploiter » — la
              vraisemblance se dérive des phases renseignées. L’atelier 5 verse le risque dans
              le registre unique.
            </p>
          </div>
        </div>
        <EbiosBoard slug={slug} canManage={canManage} studies={studies} scopes={scopes} gravityLabels={Array.from({ length: scale.size }, (_, i) => scale.gLabels[i] ?? `Niveau ${i + 1}`)} />
      </main>
    </>
  );
}
