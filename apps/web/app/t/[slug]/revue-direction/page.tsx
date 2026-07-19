import { buildReviewAgenda, canManageControls, reviewInputsReady, suggestNextReview } from '@toron/core';
import { getDashboardMetrics, getReviewCounts, listReviews, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ReviewBoard } from './review-board';

export const dynamic = 'force-dynamic';

export default async function RevueDirectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { reviews, metrics, counts, members } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    reviews: await listReviews(tx),
    metrics: await getDashboardMetrics(tx),
    counts: await getReviewCounts(tx),
    members: await listTenantMembers(tx),
  }));

  const agenda = buildReviewAgenda({
    actionsOpen: metrics.actionsOpen,
    actionsOverdue: metrics.actionsOverdue,
    coveragePct: metrics.coveragePct,
    gaps: metrics.gaps,
    incidentsOpen: counts.incidentsOpen,
    auditsInProgress: counts.auditsInProgress,
    auditsClosed: counts.auditsClosed,
    ncOpen: counts.ncOpen,
    ncInEffectivenessCheck: counts.ncInEffectivenessCheck,
    risksHigh: metrics.risksByBand.eleve + metrics.risksByBand.critique,
    risksTotal: metrics.risksTotal,
    controlsMutualized: metrics.controlsMutualized,
    evidencesStale: metrics.evidencesStale,
    documentsReviewOverdue: metrics.documentsReviewOverdue,
  });
  const ready = reviewInputsReady(agenda);
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextReviewDefault = suggestNextReview(todayIso);

  return (
    <>
      <Topbar
        crumbRoot="Système de management"
        crumbCurrent="Revue de direction"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>CLAUSE 9.3 · UNE SEULE REVUE</span><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Revue de direction</h1>
            <p className="sub">
              Une seule revue couvre le SMSI (27001) et le QMS (9001). L’ordre du jour est
              auto-généré à partir de vos données ; chaque décision se convertit en action tracée,
              et le procès-verbal est scellé (poinçon SHA-256).
            </p>
          </div>
        </div>
        <div className="mut-band" style={{ marginBottom: 16 }}>
          <p><b>Ordre du jour prêt</b> — {ready} des 7 entrées de la clause 9.3.2 sont déjà alimentées par vos données réelles (actions, audits, risques, indicateurs).</p>
        </div>
        <ReviewBoard slug={slug} canManage={canManage} reviews={reviews} agenda={agenda} members={members} nextReviewDefault={nextReviewDefault} />
      </main>
    </>
  );
}
