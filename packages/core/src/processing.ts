/**
 * Registre des activités de traitement (RGPD, art. 30). Règles pures.
 * Toron signale ce qui manque pour qu'une fiche réponde à l'article 30 ;
 * il ne juge pas la licéité du traitement.
 */

import { attestationFreshness } from './suppliers.ts';

export const LEGAL_BASES = ['consentement', 'contrat', 'obligation_legale', 'interets_vitaux', 'mission_publique', 'interet_legitime'] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

export const LEGAL_BASIS_LABEL: Record<LegalBasis, string> = {
  consentement: 'Consentement (art. 6.1 a)',
  contrat: 'Exécution d’un contrat (art. 6.1 b)',
  obligation_legale: 'Obligation légale (art. 6.1 c)',
  interets_vitaux: 'Intérêts vitaux (art. 6.1 d)',
  mission_publique: 'Mission d’intérêt public (art. 6.1 e)',
  interet_legitime: 'Intérêt légitime (art. 6.1 f)',
};

export interface ProcessingFacts {
  purpose: string;
  legalBasis: LegalBasis;
  legalBasisDetail: string | null;
  dataSubjects: readonly string[];
  dataCategories: readonly string[];
  sensitiveData: boolean;
  recipients: string | null;
  transfersOutsideEu: boolean;
  transferSafeguards: string | null;
  retention: string | null;
  securityMeasures: string | null;
}

const filled = (v: string | null | undefined) => !!v && v.trim().length > 0;

/** Rubriques de l'article 30 encore vides, dans l'ordre de la fiche. */
export function processingGaps(p: ProcessingFacts): string[] {
  const gaps: string[] = [];
  if (!filled(p.purpose)) gaps.push('Finalité');
  if (p.legalBasis === 'interet_legitime' && !filled(p.legalBasisDetail)) gaps.push('Intérêt légitime poursuivi');
  if (p.dataSubjects.length === 0) gaps.push('Personnes concernées');
  if (p.dataCategories.length === 0) gaps.push('Catégories de données');
  if (!filled(p.recipients)) gaps.push('Destinataires');
  if (p.transfersOutsideEu && !filled(p.transferSafeguards)) gaps.push('Garanties des transferts hors UE');
  if (!filled(p.retention)) gaps.push('Durée de conservation');
  if (!filled(p.securityMeasures)) gaps.push('Mesures de sécurité');
  return gaps;
}

/** Points d'attention à examiner (pas des non-conformités). */
export function processingWarnings(p: ProcessingFacts): string[] {
  const out: string[] = [];
  if (p.sensitiveData) out.push('Données sensibles (art. 9) : vérifiez l’exception applicable et la nécessité d’une analyse d’impact.');
  if (p.legalBasis === 'consentement') out.push('Consentement : conservez la preuve du recueil et permettez le retrait aussi simplement que le recueil.');
  if (p.transfersOutsideEu) out.push('Transfert hors UE : vérifiez la décision d’adéquation ou les clauses contractuelles types.');
  return out;
}

/** Révision annuelle de chaque fiche. */
export const PROCESSING_REVIEW_MONTHS = 12;

export function processingReviewDue(lastReviewedOn: string | null): string | null {
  if (!lastReviewedOn) return null;
  const [y, m, d] = lastReviewedOn.slice(0, 10).split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + PROCESSING_REVIEW_MONTHS, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export interface ProcessorAgreement {
  supplierId: string;
  name: string;
  /** Validité du dernier accord de traitement enregistré, null s'il n'expire pas ; undefined s'il n'y en a pas. */
  dpaValidUntil: string | null | undefined;
}

export type ProcessorAgreementState = 'couvert' | 'expire' | 'absent';

/** Un sous-traitant est couvert par un accord de traitement (art. 28) en cours de validité. */
export function processorAgreementState(p: ProcessorAgreement, today: string): ProcessorAgreementState {
  if (p.dpaValidUntil === undefined) return 'absent';
  return attestationFreshness(p.dpaValidUntil, today) === 'expiree' ? 'expire' : 'couvert';
}
