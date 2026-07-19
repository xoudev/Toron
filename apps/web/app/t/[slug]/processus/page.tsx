import { canManageControls } from '@toron/core';
import { listProcesses, listRisks, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ProcessBoard } from './process-board';

export const dynamic = 'force-dynamic';

export default async function ProcessusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { processes, risks, members } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    processes: await listProcesses(tx),
    risks: await listRisks(tx),
    members: await listTenantMembers(tx),
  }));

  const alerts = processes.filter((p) => p.health === 'en_alerte').length;
  const riskPicker = risks.map((r) => ({ id: r.id, title: r.title, netBand: r.netBand }));

  return (
    <>
      <Topbar
        crumbRoot="Qualité"
        crumbCurrent="Processus"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>PACK QMS · ISO 9001</span><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Processus</h1>
            <p className="sub">
              Cartographie des processus par famille (Management, Réalisation, Support). Chaque
              fiche porte sa cartouche SIPOC, ses indicateurs et ses exigences — le fil orange
              marque un contrôle ISO 27001 adossé au QMS : sécurité et qualité mutualisées.
            </p>
          </div>
        </div>
        {alerts > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p><b>{alerts} processus en alerte</b> — indicateur critique ou non-conformité ouverte. À traiter en priorité.</p>
          </div>
        ) : null}
        <ProcessBoard slug={slug} canManage={canManage} processes={processes} risks={riskPicker} members={members} />
      </main>
    </>
  );
}
