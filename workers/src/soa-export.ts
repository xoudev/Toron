import {
  failExport,
  getAssessmentItems,
  getSoaHeader,
  sealExport,
  withTenant,
  type ClaimedExport,
  type Db,
} from '@toron/db';
import { scoreAssessment, type AssessmentItemStatus } from '@toron/core';
import { compileSoa, randomVerifySlug, sha256Hex, type SoaModel } from '@toron/typst';

const STATUS_LABEL: Record<AssessmentItemStatus, string> = {
  conforme: 'Conforme',
  ecart: 'Écart',
  non_applicable: 'Non applicable',
  a_evaluer: 'À évaluer',
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

/**
 * Traite un export SoA réclamé : charge les données (transaction courte),
 * compile le PDF HORS transaction (la compilation dure des secondes), puis
 * scelle. Toute l'I/O données repasse par withTenant du tenant du job —
 * l'isolation est préservée même côté worker.
 */
export async function processSoaExport(
  db: Db,
  job: ClaimedExport,
  publicBaseUrl: string,
): Promise<void> {
  if (!job.objectRef) {
    await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, 'Campagne source absente.'));
    return;
  }

  try {
    // 1) Chargement (transaction courte)
    const data = await withTenant(db, job.tenantId, async (tx) => {
      const header = await getSoaHeader(tx, job.objectRef!);
      if (!header) return null;
      const items = await getAssessmentItems(tx, job.objectRef!);
      return { header, items };
    });
    if (!data) {
      await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, 'Campagne introuvable.'));
      return;
    }

    // 2) Modèle + compilation (hors transaction)
    const slug = randomVerifySlug();
    const score = scoreAssessment(data.items);
    const model: SoaModel = {
      frameworkName: data.header.frameworkName,
      entityName: data.header.entityName,
      scopeName: data.header.scopeName,
      generatedAtLabel: DATE_FORMAT.format(now()),
      coveragePct: score.scorePct,
      gaps: score.gaps,
      rows: data.items.map((i) => ({
        ref: i.requirementRef,
        title: i.requirementTitle,
        status: STATUS_LABEL[i.status],
        included: i.soaIncluded,
        justification: i.soaJustification,
      })),
      verifyUrl: `${publicBaseUrl.replace(/\/$/, '')}/verifier/${slug}`,
      verifySlug: slug,
    };
    const pdf = await compileSoa(model);
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
