import { groupWork, urgentWorkCount } from '@toron/core';
import { listMyWork, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { WorkList } from './work-list';

export const dynamic = 'force-dynamic';

export default async function MonTravailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);

  const today = todayParis();
  const items = await withTenant(appDb().db, ctx.tenantId, (tx) => listMyWork(tx, ctx.userId));
  const urgent = urgentWorkCount(items, today);

  return (
    <>
      <Topbar
        crumbRoot="Pilotage"
        crumbCurrent="Mon travail"
        actions={
          <>
            <span className="topbar-crumb" style={{ marginRight: 4 }}>
              {items.length} ÉLÉMENT{items.length > 1 ? 'S' : ''}
            </span>
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Mon travail</h1>
            <p className="sub">
              Tout ce dont vous êtes responsable dans {ctx.tenantName}, quel que soit le module :
              actions, incidents, non-conformités, revues de risques, preuves à renouveler, documents à
              revoir, audits et fournisseurs.
              {urgent > 0 ? <> <b>{urgent} élément{urgent > 1 ? 's demandent' : ' demande'} votre attention cette semaine.</b></> : null}
            </p>
          </div>
        </div>
        <WorkList slug={slug} today={today} groups={groupWork(items, today)} total={items.length} />
      </main>
    </>
  );
}
