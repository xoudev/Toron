import { NIS2_REGISTRATION_LABEL, NIS2_STATUS_LABEL, OBLIGATION_REGIME_LABEL, refCodeFor } from '@toron/core';
import { failExport, loadBoardReport, sealExport, withTenant, type ClaimedExport, type Db } from '@toron/db';
import { compileBoard, randomVerifySlug, sha256Hex, type BoardModel } from '@toron/typst';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });
const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });
const ISO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });

const BAND_LABEL: Record<string, string> = { critique: 'Critique', eleve: 'Élevé', moyen: 'Moyen', faible: 'Faible' };
const TREATMENT_LABEL: Record<string, string> = { reduire: 'Réduire', transferer: 'Transférer', accepter: 'Accepter', eviter: 'Éviter' };

function frDay(iso: string | null): string {
  return iso ? DAY_FORMAT.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—';
}

/**
 * Traite un export « rapport » réclamé : calcule le rapport de direction à la
 * date du jour (transaction courte), compile le PDF hors transaction, puis
 * scelle. Toute l'I/O repasse par withTenant du tenant du job.
 */
export async function processBoardExport(db: Db, job: ClaimedExport, publicBaseUrl: string): Promise<void> {
  try {
    const generatedAt = new Date();
    const today = ISO_DAY.format(generatedAt);
    const r = await withTenant(db, job.tenantId, (tx) => loadBoardReport(tx, today));
    const i = r.input;
    const slug = randomVerifySlug();

    const kpis: BoardModel['kpis'] = [
      { label: 'Couverture des exigences applicables', value: i.coveragePct === null ? '—' : `${i.coveragePct} %` },
      ...(i.risks ? [{ label: 'Risques critiques / élevés (nets)', value: `${i.risks.critical} / ${i.risks.high}` }] : []),
      { label: 'Actions en retard / ouvertes', value: `${i.actions.overdue} / ${i.actions.open}` },
      { label: 'Obligations respectées', value: `${i.obligations.met} / ${i.obligations.applicable}` },
      ...(i.incidents ? [{ label: 'Incidents en cours', value: String(i.incidents.open) }] : []),
      { label: 'Fiches RGPD complètes', value: `${i.processing.total - i.processing.incomplete} / ${i.processing.total}` },
      ...(i.training && i.training.leaders > 0
        ? [{ label: 'Dirigeants formés à la cybersécurité', value: `${i.training.leaders - i.training.leadersUntrained} / ${i.training.leaders}` }]
        : []),
      ...(i.continuity && i.continuity.activities > 0
        ? [{ label: 'Objectifs de reprise manqués', value: `${i.continuity.objectiveMissed} / ${i.continuity.activities}` }]
        : []),
    ];

    const model: BoardModel = {
      organisationName: r.organisationName,
      headline: r.headline,
      situationLabel: frDay(today),
      generatedAtLabel: DATE_FORMAT.format(generatedAt),
      messages: r.messages,
      decisions: r.decisions,
      kpis,
      nis2: [
        ...r.entities.map((e) => ({
          title: `${e.name} — ${NIS2_STATUS_LABEL[e.status]}`,
          detail: `${e.reason} Enregistrement ANSSI : ${NIS2_REGISTRATION_LABEL[e.registration].toLowerCase()}.`,
        })),
        ...r.obligationsByRegime.map((o) => ({
          title: OBLIGATION_REGIME_LABEL[o.regime],
          detail: `${o.met} obligation${o.met > 1 ? 's' : ''} respectée${o.met > 1 ? 's' : ''} sur ${o.applicable}.`,
        })),
      ],
      frameworks: r.frameworks.map((f) => `${f.name} — ${f.scorePct === null ? 'non évalué' : `${f.scorePct} % conforme`}${f.gaps > 0 ? ` · ${f.gaps} écart${f.gaps > 1 ? 's' : ''}` : ''}`),
      risks: r.topRisks && r.topRisks.map((x) => ({
        ref: refCodeFor('risque', x.id) ?? '', title: x.title, level: x.netBand ? BAND_LABEL[x.netBand] ?? x.netBand : '—',
        treatment: TREATMENT_LABEL[x.treatment] ?? x.treatment, owner: x.ownerName ?? '—',
      })),
      riskRegisterEmpty: i.risks !== null && i.risks.total === 0,
      overdueActions: r.overdueActions.map((a) => ({
        ref: refCodeFor('action', a.id) ?? '', title: a.title, priority: a.priority.toUpperCase(), due: frDay(a.dueDate), owner: a.ownerName ?? '—',
      })),
      verifyUrl: `${publicBaseUrl.replace(/\/$/, '')}/verifier/${slug}`,
      verifySlug: slug,
    };

    const pdf = await compileBoard(model);
    const sha256 = sha256Hex(pdf);
    await withTenant(db, job.tenantId, (tx) => sealExport(tx, { exportId: job.id, pdf, sha256, verifySlug: slug }));
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 400) : 'Erreur inconnue';
    await withTenant(db, job.tenantId, (tx) => failExport(tx, job.id, message)).catch(() => {});
    throw err;
  }
}
