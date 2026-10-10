import { canManageControls, freshnessNeedsAttention } from '@toron/core';
import { listControls, listEvidences, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { EvidenceVault } from './evidence-vault';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Coffre de preuves — Toron' };

export default async function PreuvesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { evidences, controls } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    evidences: await listEvidences(tx),
    controls: await listControls(tx),
  }));

  // Seules les preuves en vigueur sont à renouveler : une version remplacée
  // reste expirée dans l'historique sans rien demander.
  const stale = evidences.filter((e) => e.supersededById === null && freshnessNeedsAttention(e.freshness)).length;

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
            <ExportCsvLink slug={slug} registre="preuves" />
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Coffre de preuves</h1>
            <p className="sub">
              Chaque fichier reçoit une empreinte SHA-256, qui prouve qu’il n’a pas été modifié, et une
              date de validité. Une preuve rattachée à un contrôle sert pour tous les référentiels qu’il
              couvre. Une preuve expirée est signalée, mais ne change pas seule le statut d’une exigence.
            </p>
          </div>
        </div>

        {stale > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p>
              <b>{stale} preuve{stale > 1 ? 's' : ''} à renouveler</b> — expirée{stale > 1 ? 's' : ''} ou bientôt échue{stale > 1 ? 's' : ''}.
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
