import { canManageControls } from '@toron/core';
import { listActions, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { PlanBoard } from './plan-board';

export const dynamic = 'force-dynamic';

export default async function PlanActionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { actions, members } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    actions: await listActions(tx),
    members: await listTenantMembers(tx),
  }));

  const late = actions.filter((a) => a.effectiveStatus === 'en_retard').length;
  const open = actions.filter((a) => a.status !== 'termine').length;

  return (
    <>
      <Topbar
        crumbRoot="Conformité"
        crumbCurrent="Plan d’action"
        actions={
          <>
            <span className="topbar-crumb" style={{ marginRight: 4 }}>
              {open} OUVERTE{open > 1 ? 'S' : ''}
            </span>
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Plan d’action</h1>
            <p className="sub">
              Un seul plan pour toutes les origines — risques, écarts, constats. Le retard se calcule
              sur l’échéance, il ne se déclare pas.
            </p>
          </div>
        </div>

        {late > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p>
              <b>{late} action{late > 1 ? 's' : ''} en retard</b> — échéance dépassée, à traiter en priorité.
            </p>
          </div>
        ) : null}

        <PlanBoard slug={slug} canManage={canManage} actions={actions} members={members} />
      </main>
    </>
  );
}
