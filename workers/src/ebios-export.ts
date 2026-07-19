import {
  failExport,
  getReviewEntityName,
  getStudy,
  sealExport,
  withTenant,
  type ClaimedExport,
  type Db,
} from '@toron/db';
import { EBIOS_WORKSHOPS, KILL_CHAIN_PHASES, LIKELIHOOD_LABEL } from '@toron/core';
import { compileEbios, randomVerifySlug, sha256Hex, type EbiosModel } from '@toron/typst';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });

/**
 * Traite un export EBIOS (livrable ANSSI) réclamé. Charge l'étude (transaction
 * courte), compile le PDF hors transaction, puis scelle. L'I/O repasse par
 * withTenant du tenant du job — l'isolation est préservée côté worker.
 */
export async function processEbiosExport(db: Db, job: ClaimedExport, publicBaseUrl: string): Promise<void> {
  if (!job.objectRef) {
    await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, 'Étude source absente.'));
    return;
  }

  try {
    const data = await withTenant(db, job.tenantId, async (tx) => {
      const study = await getStudy(tx, job.objectRef!);
      if (!study) return null;
      const entityName = await getReviewEntityName(tx);
      return { study, entityName };
    });
    if (!data) {
      await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, 'Étude introuvable.'));
      return;
    }

    const slug = randomVerifySlug();
    const { study, entityName } = data;
    const workshop = EBIOS_WORKSHOPS.find((w) => w.num === study.workshop);
    const model: EbiosModel = {
      title: study.title,
      entityName: entityName ?? study.scopeName ?? 'Périmètre',
      scopeLabel: study.scopeName ?? '—',
      workshopLabel: workshop ? `Atelier ${workshop.num} — ${workshop.label}` : `Atelier ${study.workshop}`,
      generatedAtLabel: DATE_FORMAT.format(now()),
      scenarios: study.scenarios.map((sc) => ({
        riskSource: sc.riskSource,
        targetObjective: sc.targetObjective,
        likelihoodLabel: sc.likelihood ? `${sc.likelihood.toUpperCase()} · ${LIKELIHOOD_LABEL[sc.likelihood]}` : '—',
        generated: sc.generatedRiskId !== null,
        phases: KILL_CHAIN_PHASES.map((ph) => ({
          label: ph.label,
          actions: sc.actions.filter((a) => a.phase === ph.key).map((a) => ({ tech: a.mitreId, label: a.label })),
        })),
      })),
      verifyUrl: `${publicBaseUrl.replace(/\/$/, '')}/verifier/${slug}`,
      verifySlug: slug,
    };
    const pdf = await compileEbios(model);
    const sha256 = sha256Hex(pdf);

    await withTenant(db, job.tenantId, (tx) => sealExport(tx, { exportId: job.id, pdf, sha256, verifySlug: slug }));
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 400) : 'Erreur inconnue';
    await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, message)).catch(() => {});
    throw err;
  }
}

function now(): Date {
  return new Date();
}
