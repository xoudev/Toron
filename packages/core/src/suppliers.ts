/**
 * Évaluation des fournisseurs (module 5.10). Règles pures et testées.
 * Le questionnaire est rempli par l'organisation à partir des réponses et
 * pièces du fournisseur ; la note et l'appréciation sont toujours calculées
 * ici, jamais reçues du navigateur.
 */

import { freshnessState, type FreshnessState } from './evidences.ts';

export type SupplierTier = 't1' | 't2' | 't3';

export const SUPPLIER_ANSWERS = ['oui', 'partiel', 'non', 'na'] as const;
export type SupplierAnswer = (typeof SUPPLIER_ANSWERS)[number];

export const SUPPLIER_ANSWER_LABEL: Record<SupplierAnswer, string> = {
  oui: 'Oui',
  partiel: 'Partiel',
  non: 'Non',
  na: 'Sans objet',
};

export interface SupplierQuestion {
  key: string;
  theme: string;
  label: string;
  /** Poids dans la note (1 à 3). */
  weight: number;
  /** Un « non » rend l'évaluation insuffisante pour un fournisseur critique (T1). */
  blockingForCritical?: boolean;
  /** Intitulé de l'action corrective proposée quand la réponse n'est pas « oui ». */
  correctiveAction: string;
}

export const SUPPLIER_QUESTIONS: readonly SupplierQuestion[] = [
  { key: 'gouvernance', theme: 'Gouvernance', weight: 2, label: 'Une politique de sécurité est formalisée et un responsable sécurité est désigné.', correctiveAction: 'Obtenir la politique de sécurité et le contact du responsable sécurité' },
  { key: 'mfa', theme: 'Accès', weight: 3, blockingForCritical: true, label: 'Les accès à nos données et à nos systèmes exigent une authentification multifacteur.', correctiveAction: 'Exiger l’authentification multifacteur sur les accès à nos données' },
  { key: 'chiffrement', theme: 'Protection des données', weight: 2, label: 'Nos données sont chiffrées en transit et au repos.', correctiveAction: 'Obtenir l’engagement de chiffrement en transit et au repos' },
  { key: 'localisation', theme: 'Protection des données', weight: 2, label: 'Nos données sont hébergées et traitées dans l’Union européenne, sans transfert hors UE non encadré.', correctiveAction: 'Encadrer la localisation des données et les transferts hors UE' },
  { key: 'incidents', theme: 'Incidents', weight: 3, blockingForCritical: true, label: 'Le contrat engage le fournisseur à nous notifier tout incident de sécurité sous 24 heures.', correctiveAction: 'Ajouter au contrat la notification des incidents sous 24 h' },
  { key: 'continuite', theme: 'Continuité', weight: 2, label: 'Un plan de continuité existe, et les sauvegardes sont restaurées avec succès au moins une fois par an.', correctiveAction: 'Demander le résultat du dernier test de continuité et de restauration' },
  { key: 'vulnerabilites', theme: 'Vulnérabilités', weight: 2, label: 'Les correctifs de sécurité sont appliqués selon un délai défini, et un test d’intrusion est mené chaque année.', correctiveAction: 'Obtenir la synthèse du dernier test d’intrusion et la politique de correctifs' },
  { key: 'sous_traitance', theme: 'Sous-traitance', weight: 1, label: 'Les sous-traitants ultérieurs sont identifiés et soumis aux mêmes exigences.', correctiveAction: 'Obtenir la liste des sous-traitants ultérieurs et leurs engagements' },
  { key: 'rgpd', theme: 'RGPD', weight: 2, label: 'Un accord de traitement des données personnelles (article 28 du RGPD) est signé.', correctiveAction: 'Faire signer l’accord de traitement des données (art. 28 RGPD)' },
  { key: 'reversibilite', theme: 'Contrat', weight: 1, label: 'Le contrat prévoit la réversibilité et la restitution des données en fin de contrat.', correctiveAction: 'Négocier une clause de réversibilité et de restitution des données' },
  { key: 'audit', theme: 'Contrat', weight: 1, label: 'Nous disposons d’un droit d’audit ou d’un rapport d’audit indépendant récent.', correctiveAction: 'Obtenir un droit d’audit ou un rapport d’audit indépendant' },
];

export const SUPPLIER_RATINGS = ['satisfaisant', 'sous_reserve', 'insuffisant'] as const;
export type SupplierRating = (typeof SUPPLIER_RATINGS)[number];

export const SUPPLIER_RATING_LABEL: Record<SupplierRating, string> = {
  satisfaisant: 'Satisfaisant',
  sous_reserve: 'Sous réserve',
  insuffisant: 'Insuffisant',
};

/** Seuils de l'appréciation. */
export const SATISFACTORY_SCORE = 80;
export const ACCEPTABLE_SCORE = 50;

export type SupplierAnswers = Record<string, SupplierAnswer>;

export type SupplierAssessmentResult =
  | { ok: true; score: number; rating: SupplierRating; blocking: string[]; gaps: string[] }
  | { ok: false; reason: 'incomplet' | 'sans_objet'; missing: string[] };

const ANSWER_VALUE: Record<Exclude<SupplierAnswer, 'na'>, number> = { oui: 1, partiel: 0.5, non: 0 };

/**
 * Note sur 100 pondérée par question (« sans objet » exclu du calcul).
 * Appréciation : insuffisante dès qu'un point bloquant manque chez un
 * fournisseur critique ; sinon selon les seuils 80 et 50.
 * `gaps` liste, dans l'ordre du questionnaire, les réponses « non » puis
 * « partiel » : ce sont les actions correctives à proposer.
 */
export function assessSupplier(answers: SupplierAnswers, tier: SupplierTier): SupplierAssessmentResult {
  const missing = SUPPLIER_QUESTIONS.filter((q) => !SUPPLIER_ANSWERS.includes(answers[q.key] as SupplierAnswer)).map((q) => q.key);
  if (missing.length > 0) return { ok: false, reason: 'incomplet', missing };

  let earned = 0;
  let possible = 0;
  for (const q of SUPPLIER_QUESTIONS) {
    const a = answers[q.key] as SupplierAnswer;
    if (a === 'na') continue;
    possible += q.weight;
    earned += q.weight * ANSWER_VALUE[a];
  }
  if (possible === 0) return { ok: false, reason: 'sans_objet', missing: [] };

  const score = Math.round((earned / possible) * 100);
  const blocking = tier === 't1'
    ? SUPPLIER_QUESTIONS.filter((q) => q.blockingForCritical && answers[q.key] === 'non').map((q) => q.key)
    : [];
  const rating: SupplierRating = blocking.length > 0
    ? 'insuffisant'
    : score >= SATISFACTORY_SCORE ? 'satisfaisant' : score >= ACCEPTABLE_SCORE ? 'sous_reserve' : 'insuffisant';
  const gaps = [
    ...SUPPLIER_QUESTIONS.filter((q) => answers[q.key] === 'non'),
    ...SUPPLIER_QUESTIONS.filter((q) => answers[q.key] === 'partiel'),
  ].map((q) => q.key);
  return { ok: true, score, rating, blocking, gaps };
}

export function supplierQuestion(key: string): SupplierQuestion | undefined {
  return SUPPLIER_QUESTIONS.find((q) => q.key === key);
}

/**
 * Action corrective demandée au fournisseur : P1 sous 30 jours pour un point
 * bloquant chez un fournisseur critique, P2 sous 90 jours sinon.
 */
export function supplierCorrectiveDefaults(question: SupplierQuestion, tier: SupplierTier, today: string): { priority: 'p1' | 'p2'; dueDate: string } {
  const urgent = tier === 't1' && question.blockingForCritical === true;
  const [y, m, d] = today.slice(0, 10).split('-').map(Number) as [number, number, number];
  const due = new Date(Date.UTC(y, m - 1, d + (urgent ? 30 : 90)));
  return { priority: urgent ? 'p1' : 'p2', dueDate: due.toISOString().slice(0, 10) };
}

/** Périodicité de réévaluation selon la criticité, en mois. */
export const REASSESSMENT_MONTHS: Record<SupplierTier, number> = { t1: 12, t2: 24, t3: 36 };

export type SupplierAssessmentState = 'jamais' | 'a_jour' | 'a_refaire';

function addMonths(isoDay: string, months: number): string {
  const [y, m, d] = isoDay.slice(0, 10).split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Date à laquelle l'évaluation doit être refaite (AAAA-MM-JJ). */
export function nextAssessmentDue(tier: SupplierTier, lastAssessedOn: string): string {
  return addMonths(lastAssessedOn, REASSESSMENT_MONTHS[tier]);
}

export function supplierAssessmentState(tier: SupplierTier, lastAssessedOn: string | null, today: string): SupplierAssessmentState {
  if (!lastAssessedOn) return 'jamais';
  return nextAssessmentDue(tier, lastAssessedOn) < today.slice(0, 10) ? 'a_refaire' : 'a_jour';
}

export const ATTESTATION_KINDS = ['iso27001', 'iso9001', 'hds', 'secnumcloud', 'soc2', 'pentest', 'assurance', 'dpa', 'autre'] as const;
export type AttestationKind = (typeof ATTESTATION_KINDS)[number];

export const ATTESTATION_KIND_LABEL: Record<AttestationKind, string> = {
  iso27001: 'Certificat ISO/IEC 27001',
  iso9001: 'Certificat ISO 9001',
  hds: 'Certification HDS',
  secnumcloud: 'Qualification SecNumCloud',
  soc2: 'Rapport SOC 2',
  pentest: 'Synthèse de test d’intrusion',
  assurance: 'Attestation d’assurance',
  dpa: 'Accord de traitement (art. 28 RGPD)',
  autre: 'Autre attestation',
};

/** Fraîcheur d'une attestation : même règle que les preuves (30 jours). */
export function attestationFreshness(validUntil: string | null, today: string): FreshnessState {
  return freshnessState(validUntil ? new Date(`${validUntil.slice(0, 10)}T00:00:00Z`) : null, new Date(`${today.slice(0, 10)}T00:00:00Z`));
}

export interface SupplierAttention {
  /** Évaluation jamais faite ou à refaire. */
  assessment: SupplierAssessmentState;
  /** Dernière évaluation insuffisante. */
  insufficient: boolean;
  /** Au moins une attestation expirée. */
  expiredAttestation: boolean;
}

/** Fournisseurs à traiter en priorité : critiques sans évaluation à jour ou jugés insuffisants. */
export function supplierNeedsAttention(tier: SupplierTier, a: SupplierAttention): boolean {
  if (a.insufficient || a.expiredAttestation) return tier !== 't3';
  return tier === 't1' && a.assessment !== 'a_jour';
}
