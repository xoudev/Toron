import { listAssets, listControls, listExceptions, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { ModuleDisabled } from '@/components/module-disabled';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ExceptionBoard } from './exception-board';

export const dynamic = 'force-dynamic';

export default async function DerogationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  if (!(await getOrganisationOverview(ctx.tenantId)).enabled('derogations')) return <ModuleDisabled slug={slug} module="derogations" role={ctx.role} />;

  const today = todayParis();
  const { exceptions, members, controls, assets } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    exceptions: await listExceptions(tx, today),
    members: await listTenantMembers(tx),
    controls: await listControls(tx),
    assets: await listAssets(tx),
  }));
  const active = exceptions.filter((e) => e.state === 'en_vigueur' || e.state === 'a_echeance').length;
  const lapsed = exceptions.filter((e) => e.state === 'echue').length;

  return (
    <>
      <Topbar
        crumbRoot="Système de management"
        crumbCurrent="Dérogations"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{active} EN VIGUEUR</span><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Dérogations</h1>
            <p className="sub">
              Les écarts tolérés à une règle — politique, contrôle, procédure — avec leur justification, leurs mesures
              compensatoires et une échéance. Une autre personne que le demandeur statue ; au-delà de douze mois, on
              renouvelle et on statue à nouveau.
            </p>
          </div>
        </div>
        {lapsed > 0 ? (
          <div className="mut-band drg-lapsed" style={{ marginBottom: 16 }}>
            <p>
              <b>{lapsed} dérogation{lapsed > 1 ? 's' : ''} échue{lapsed > 1 ? 's' : ''}</b> sans clôture : l’écart n’est plus
              couvert. Renouvelez-la si l’écart persiste, ou clôturez-la si la règle s’applique de nouveau.
            </p>
          </div>
        ) : null}
        <ExceptionBoard
          slug={slug}
          today={today}
          role={ctx.role}
          userId={ctx.userId}
          exceptions={exceptions}
          members={members}
          controls={controls.map((c) => ({ id: c.id, label: c.title }))}
          assets={assets.map((a) => ({ id: a.id, label: a.name }))}
        />
      </main>
    </>
  );
}
