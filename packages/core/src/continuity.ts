/**
 * Continuité d'activité (ISO 27001 A.5.29, A.5.30 et A.8.14, NIS 2
 * art. 21 §2 c). Règles pures : criticité, état de chaque activité critique
 * au regard de ses exercices, échéance du bilan d'impact, saisie valide.
 */

import { canManageControls, type MembershipRole } from './authz.ts';
import { addMonthsIso } from './dates.ts';

export const CRITICALITY_LEVELS = [1, 2, 3, 4] as const;
export type Criticality = (typeof CRITICALITY_LEVELS)[number];

export const CRITICALITY_LABEL: Record<Criticality, string> = {
  1: 'Faible',
  2: 'Modérée',
  3: 'Forte',
  4: 'Vitale',
};

export const EXERCISE_KINDS = ['restauration', 'bascule', 'table', 'crise', 'alerte'] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

export const EXERCISE_KIND_LABEL: Record<ExerciseKind, string> = {
  restauration: 'Test de restauration',
  bascule: 'Test de bascule',
  table: 'Exercice sur table',
  crise: 'Simulation de crise',
  alerte: 'Test de la chaîne d’alerte',
};

export const EXERCISE_STATUSES = ['planifie', 'realise', 'annule'] as const;
export type ExerciseStatus = (typeof EXERCISE_STATUSES)[number];

export const EXERCISE_RESULTS = ['atteint', 'partiel', 'non_atteint'] as const;
export type ExerciseResult = (typeof EXERCISE_RESULTS)[number];

export const EXERCISE_RESULT_LABEL: Record<ExerciseResult, string> = {
  atteint: 'Objectifs atteints',
  partiel: 'Partiellement atteints',
  non_atteint: 'Objectifs non atteints',
};

/** Un bilan d'impact se revoit chaque année ; une activité se teste au moins une fois par an. */
export const BIA_REVIEW_MONTHS = 12;
export const EXERCISE_WINDOW_MONTHS = 12;

export function canManageContinuity(role: MembershipRole): boolean {
  return canManageControls(role);
}

export function biaReviewDue(assessedOn: string): string {
  return addMonthsIso(assessedOn, BIA_REVIEW_MONTHS);
}

export interface ActivityExercise {
  heldOn: string;
  result: ExerciseResult;
  recoveryMinutes: number | null;
}

export type ActivityContinuityState = 'non_teste' | 'objectif_manque' | 'partiel' | 'teste';

export const ACTIVITY_CONTINUITY_STATE_LABEL: Record<ActivityContinuityState, string> = {
  non_teste: 'Non testée depuis un an',
  objectif_manque: 'Objectif de reprise manqué',
  partiel: 'Test partiel',
  teste: 'Testée, objectif tenu',
};

/**
 * État d'une activité d'après le dernier exercice réalisé qui la couvre sur
 * douze mois : une reprise mesurée au-delà de la DMIA vaut objectif manqué,
 * quel que soit le résultat déclaré.
 */
export function activityContinuityState(
  input: { rtoHours: number; lastExercise: ActivityExercise | null },
  today: string,
): ActivityContinuityState {
  const e = input.lastExercise;
  if (!e || e.heldOn <= addMonthsIso(today, -EXERCISE_WINDOW_MONTHS) || e.heldOn > today) return 'non_teste';
  if (e.result === 'non_atteint' || (e.recoveryMinutes !== null && e.recoveryMinutes > input.rtoHours * 60)) return 'objectif_manque';
  return e.result === 'partiel' ? 'partiel' : 'teste';
}

/** Motif de refus d'un bilan d'impact, ou null. */
export function activityError(input: { rtoHours: number; rpoHours: number }): string | null {
  if (!Number.isInteger(input.rtoHours) || !Number.isInteger(input.rpoHours) || input.rtoHours < 0 || input.rpoHours < 0) {
    return 'La DMIA et la PDMA s’expriment en heures entières, positives.';
  }
  if (input.rtoHours > 8760 || input.rpoHours > 8760) return 'La DMIA et la PDMA ne dépassent pas un an (8 760 heures).';
  return null;
}

/** Motif de refus d'un exercice, ou null s'il peut être enregistré. */
export function exerciseError(
  input: { status: ExerciseStatus; scheduledOn: string; result: ExerciseResult | null; recoveryMinutes: number | null; findings: string | null },
  today: string,
): string | null {
  if (input.status === 'realise') {
    if (input.scheduledOn > today) return 'Un exercice futur ne peut pas être déclaré réalisé : enregistrez son résultat une fois tenu.';
    if (!input.result) return 'Indiquez le résultat de l’exercice réalisé.';
    if (input.result !== 'atteint' && (input.findings ?? '').trim().length < 10) {
      return 'Un objectif manqué se documente : décrivez ce qui n’a pas fonctionné (10 caractères au moins).';
    }
    return null;
  }
  if (input.result !== null || input.recoveryMinutes !== null) {
    return 'Le résultat et la durée de reprise se saisissent une fois l’exercice réalisé.';
  }
  return null;
}

export interface ContinuityActivitySummary {
  criticality: Criticality;
  state: ActivityContinuityState;
  assessedOn: string;
}

export interface ContinuitySummary {
  activities: number;
  vital: number;
  /** Activités couvertes par un exercice réalisé sur douze mois. */
  tested: number;
  /** Activités vitales ou fortes (criticité ≥ 3) sans exercice réalisé sur douze mois. */
  criticalUntested: number;
  objectiveMissed: number;
  biaDue: number;
}

export function continuitySummary(activities: readonly ContinuityActivitySummary[], today: string): ContinuitySummary {
  return {
    activities: activities.length,
    vital: activities.filter((a) => a.criticality === 4).length,
    tested: activities.filter((a) => a.state !== 'non_teste').length,
    criticalUntested: activities.filter((a) => a.criticality >= 3 && a.state === 'non_teste').length,
    objectiveMissed: activities.filter((a) => a.state === 'objectif_manque').length,
    biaDue: activities.filter((a) => biaReviewDue(a.assessedOn) < today).length,
  };
}
