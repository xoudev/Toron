import { canManageControls } from '@toron/core';
import { listAudits, listFrameworks, listScopes, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { AuditBoard } from './audit-board';

export const dynamic = 'force-dynamic';

export default async function AuditsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { audits, frameworks, scopes, members } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    audits: await listAudits(tx),
    frameworks: await listFrameworks(tx),
    scopes: await listScopes(tx),
    members: await listTenantMembers(tx),
  }));

  const openNc = audits.reduce((n, a) => n + a.ncCount, 0);

  return (
    <>
      <Topbar
        crumbRoot="Système de management"
        crumbCurrent="Audits internes"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{audits.length} AUDIT{audits.length > 1 ? 'S' : ''}</span><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Audits internes</h1>
            <p className="sub">
              Programme d’audit, constats et séparation des tâches (RM §5.8). Chaque
              non-conformité relevée se convertit en action corrective — un seul plan d’action.
            </p>
          </div>
        </div>
        {openNc > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p><b>{openNc} non-conformité{openNc > 1 ? 's' : ''}</b> relevée{openNc > 1 ? 's' : ''} en audit — à convertir en action corrective si ce n’est pas déjà fait.</p>
          </div>
        ) : null}
        <AuditBoard slug={slug} canManage={canManage} audits={audits} frameworks={frameworks} scopes={scopes} members={members} />
      </main>
    </>
  );
}
