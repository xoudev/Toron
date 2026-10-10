import { groupWork, urgentWorkCount, workKindEnabled } from '@toron/core';
import { listMyWork, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { WorkList } from './work-list';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Mon travail — Toron' };

export default async function MonTravailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);

  const today = todayParis();
  const { disabledModules } = await getOrganisationOverview(ctx.tenantId);
  const items = (await withTenant(appDb().db, ctx.tenantId, (tx) => listMyWork(tx, ctx.userId)))
    .filter((i) => workKindEnabled(i.kind, disabledModules));
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
              actions, incidents, non-conformités, documents à lire ou à revoir, revues de risques, preuves à
              renouveler, audits et fournisseurs.
              {urgent > 0 ? <> <b>{urgent} élément{urgent > 1 ? 's demandent' : ' demande'} votre attention cette semaine.</b></> : null}
            </p>
          </div>
        </div>
        <WorkList slug={slug} today={today} groups={groupWork(items, today)} total={items.length} />
      </main>
    </>
  );
}
