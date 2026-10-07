/**
 * Revues d'efficacité des contrôles internes. Règles pures : échéance de la
 * prochaine revue selon la fréquence, état du suivi à une date, droit de
 * consigner une revue, suites à donner à un résultat. Un contrôle rattaché à
 * des exigences ne prouve rien tant qu'on ne vérifie pas qu'il fonctionne.
 */

import { canManageControls, type MembershipRole } from './authz.ts';
import { addMonthsIso } from './dates.ts';
import { daysUntil } from './work.ts';

export const REVIEW_FREQUENCIES = ['mensuelle', 'trimestrielle', 'semestrielle', 'annuelle'] as const;
export type ReviewFrequency = (typeof REVIEW_FREQUENCIES)[number];

export const REVIEW_FREQUENCY_LABEL: Record<ReviewFrequency, string> = {
  mensuelle: 'Mensuelle',
  trimestrielle: 'Trimestrielle',
  semestrielle: 'Semestrielle',
  annuelle: 'Annuelle',
};

/** Période entre deux revues, en mois. */
export const REVIEW_FREQUENCY_MONTHS: Record<ReviewFrequency, number> = {
  mensuelle: 1,
  trimestrielle: 3,
  semestrielle: 6,
  annuelle: 12,
};

export const CONTROL_REVIEW_RESULTS = ['efficace', 'partiellement_efficace', 'inefficace'] as const;
export type ControlReviewResult = (typeof CONTROL_REVIEW_RESULTS)[number];

export const CONTROL_REVIEW_RESULT_LABEL: Record<ControlReviewResult, string> = {
  efficace: 'Efficace',
  partiellement_efficace: 'Partiellement efficace',
  inefficace: 'Inefficace',
};

/** Techniques de vérification usuelles en audit (ISO 19011, reformulées). */
export const CONTROL_REVIEW_METHODS = ['revue_documentaire', 'entretien', 'observation', 'echantillonnage', 'test_technique'] as const;
export type ControlReviewMethod = (typeof CONTROL_REVIEW_METHODS)[number];

export const CONTROL_REVIEW_METHOD_LABEL: Record<ControlReviewMethod, string> = {
  revue_documentaire: 'Revue documentaire',
  entretien: 'Entretien',
  observation: 'Observation',
  echantillonnage: 'Échantillonnage',
  test_technique: 'Test technique',
};

/** Fenêtre « revue bientôt due », en jours. */
export const CONTROL_REVIEW_NOTICE_DAYS = 15;

export interface ControlReviewSchedule {
  frequency: ReviewFrequency | null;
  /** Dernière revue consignée (AAAA-MM-JJ), ou null si jamais revu. */
  lastReviewedOn: string | null;
  /** Date de création du contrôle : la première revue est due une période plus tard. */
  createdOn: string;
}

/** Date de la prochaine revue, ou null si le contrôle n'a pas de fréquence de revue. */
export function nextControlReview(s: ControlReviewSchedule): string | null {
  if (!s.frequency) return null;
  return addMonthsIso(s.lastReviewedOn ?? s.createdOn, REVIEW_FREQUENCY_MONTHS[s.frequency]);
}

export const CONTROL_REVIEW_STATES = ['sans_frequence', 'a_jour', 'bientot', 'en_retard'] as const;
export type ControlReviewState = (typeof CONTROL_REVIEW_STATES)[number];

export const CONTROL_REVIEW_STATE_LABEL: Record<ControlReviewState, string> = {
  sans_frequence: 'Sans fréquence de revue',
  a_jour: 'À jour',
  bientot: 'Revue bientôt due',
  en_retard: 'Revue en retard',
};

/** Où en est le suivi d'un contrôle à une date. */
export function controlReviewState(s: ControlReviewSchedule, today: string): ControlReviewState {
  const due = nextControlReview(s);
  if (due === null) return 'sans_frequence';
  const days = daysUntil(due, today);
  if (days < 0) return 'en_retard';
  return days <= CONTROL_REVIEW_NOTICE_DAYS ? 'bientot' : 'a_jour';
}

/**
 * Consigner une revue : les rôles qui gèrent les contrôles, et l'auditeur,
 * dont c'est le métier de tester sans modifier ce qu'il audite.
 */
export function canRecordControlReview(role: MembershipRole): boolean {
  return canManageControls(role) || role === 'auditeur';
}

/** Un résultat autre qu'« efficace » appelle des observations et une action corrective. */
export function reviewNeedsCorrection(result: ControlReviewResult): boolean {
  return result !== 'efficace';
}

/** Motif de refus d'une revue, ou null si elle peut être consignée. */
export function controlReviewError(input: { result: ControlReviewResult; observations: string | null; reviewedOn: string }, today: string): string | null {
  if (input.reviewedOn > today) return 'La date de revue ne peut pas être dans le futur.';
  if (reviewNeedsCorrection(input.result) && (input.observations ?? '').trim().length < 10) {
    return 'Décrivez ce qui ne fonctionne pas (10 caractères au moins) : c’est le point de départ de l’action corrective.';
  }
  return null;
}

/** Intitulé et priorité proposés pour l'action corrective d'un contrôle défaillant. */
export function controlCorrectiveAction(controlTitle: string, result: ControlReviewResult): { title: string; priority: 'p1' | 'p2' } {
  const name = controlTitle.trim().replace(/\s+/g, ' ');
  const short = name.length > 150 ? `${name.slice(0, 147)}…` : name;
  return {
    title: `Rétablir l’efficacité du contrôle « ${short} »`,
    priority: result === 'inefficace' ? 'p1' : 'p2',
  };
}
