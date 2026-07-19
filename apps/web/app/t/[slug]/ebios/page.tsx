import { canManageControls } from '@toron/core';
import { listScopes, listStudies, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { EbiosBoard } from './ebios-board';

export const dynamic = 'force-dynamic';

export default async function EbiosPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { studies, scopes } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    studies: await listStudies(tx),
    scopes: await listScopes(tx),
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
        <EbiosBoard slug={slug} canManage={canManage} studies={studies} scopes={scopes} />
      </main>
    </>
  );
}
