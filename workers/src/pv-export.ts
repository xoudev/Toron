import {
  failExport,
  getDashboardMetrics,
  getReview,
  getReviewCounts,
  getReviewEntityName,
  sealExport,
  withTenant,
  type ClaimedExport,
  type Db,
} from '@toron/db';
import { buildReviewAgenda } from '@toron/core';
import { compilePv, randomVerifySlug, sha256Hex, type PvModel } from '@toron/typst';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});
const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });

function frDay(iso: string | null): string {
  if (!iso) return '—';
  return DAY_FORMAT.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

/**
 * Traite un export PV (procès-verbal de revue de direction) réclamé.
 * Charge la séance et les métriques réelles (transaction courte), compile le
 * PDF hors transaction, puis scelle. Toute l'I/O repasse par withTenant du
 * tenant du job — l'isolation est préservée côté worker.
 */
export async function processPvExport(
  db: Db,
  job: ClaimedExport,
  publicBaseUrl: string,
): Promise<void> {
  if (!job.objectRef) {
    await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, 'Revue source absente.'));
    return;
  }

  try {
    // 1) Chargement (transaction courte)
    const data = await withTenant(db, job.tenantId, async (tx) => {
      const review = await getReview(tx, job.objectRef!);
      if (!review) return null;
      const metrics = await getDashboardMetrics(tx);
      const counts = await getReviewCounts(tx);
      const entityName = await getReviewEntityName(tx);
      return { review, metrics, counts, entityName };
    });
    if (!data) {
      await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, 'Revue introuvable.'));
      return;
    }

    // 2) Modèle + compilation (hors transaction)
    const slug = randomVerifySlug();
    const { review, metrics, counts, entityName } = data;
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

    const model: PvModel = {
      title: review.title,
      entityName: entityName ?? review.scopeLabel,
      scopeLabel: review.scopeLabel,
      heldAtLabel: frDay(review.heldAt),
      generatedAtLabel: DATE_FORMAT.format(now()),
      participants: review.participants.map((p) => p.name),
      agenda: agenda.map((s) => ({
        n: s.n,
        clause: s.clause,
        title: s.title,
        lines: [s.summary, ...s.bullets.map((b) => `${b.head} ${b.body}`)],
      })),
      decisions: review.decisions.map((d) => ({
        body: d.body,
        actionNote: d.actionId ? 'convertie en action tracée' : null,
      })),
      nextReviewLabel: review.nextReviewAt ? frDay(review.nextReviewAt) : null,
      verifyUrl: `${publicBaseUrl.replace(/\/$/, '')}/verifier/${slug}`,
      verifySlug: slug,
    };
    const pdf = await compilePv(model);
    const sha256 = sha256Hex(pdf);

    // 3) Scellage (transaction courte)
    await withTenant(db, job.tenantId, (tx) =>
      sealExport(tx, { exportId: job.id, pdf, sha256, verifySlug: slug }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 400) : 'Erreur inconnue';
    await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, message)).catch(() => {});
    throw err;
  }
}

// new Date() encapsulé pour rester le seul point d'horloge du module.
function now(): Date {
  return new Date();
}
