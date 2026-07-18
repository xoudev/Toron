import { canManageControls } from '@toron/core';
import { listControls, listEvidences, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { EvidenceVault } from './evidence-vault';

export const dynamic = 'force-dynamic';

export default async function PreuvesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { evidences, controls } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    evidences: await listEvidences(tx),
    controls: await listControls(tx),
  }));

  const stale = evidences.filter((e) => e.freshness === 'expiree' || e.freshness === 'bientot').length;

  return (
    <>
      <Topbar
        crumbRoot="Système de management"
        crumbCurrent="Coffre de preuves"
        actions={
          <>
            <span className="topbar-crumb" style={{ marginRight: 4 }}>
              {evidences.length} PREUVE{evidences.length > 1 ? 'S' : ''}
            </span>
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Coffre de preuves</h1>
            <p className="sub">
              Preuves empreintées (SHA-256) et datées de fraîcheur. Une preuve liée à un contrôle
              mutualisé couvre plusieurs référentiels — une preuve expirée signale, elle ne déclasse pas.
            </p>
          </div>
        </div>

        {stale > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p>
              <b>{stale} preuve{stale > 1 ? 's' : ''} à renouveler</b> — expirée ou bientôt échue.
            </p>
          </div>
        ) : null}

        <EvidenceVault
          slug={slug}
          canManage={canManage}
          evidences={evidences}
          controls={controls.map((c) => ({ id: c.id, title: c.title }))}
        />
      </main>
    </>
  );
}
