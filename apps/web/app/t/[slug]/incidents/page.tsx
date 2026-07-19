import { canManageControls } from '@toron/core';
import { listIncidents, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { IncidentsBoard } from './incidents-board';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const incidents = await withTenant(appDb().db, ctx.tenantId, (tx) => listIncidents(tx));
  const open = incidents.filter((i) => i.status !== 'clos').length;

  return (
    <>
      <Topbar
        crumbRoot="Risques"
        crumbCurrent="Incidents"
        actions={
          <>
            <span className="topbar-crumb" style={{ marginRight: 4 }}>{open} OUVERT{open > 1 ? 'S' : ''}</span>
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Incidents</h1>
            <p className="sub">
              Chronologie réglementaire NIS 2 — alerte 24 h, notification 72 h, rapport J+30. Les
              échéances se calculent à la qualification ; la timeline est immuable.
            </p>
          </div>
        </div>
        <IncidentsBoard slug={slug} canManage={canManage} incidents={incidents} />
      </main>
    </>
  );
}
