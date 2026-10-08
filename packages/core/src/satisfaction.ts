/**
 * Satisfaction client (ISO 9001 9.1.2, plan §7.3). Règles pures : score
 * NPS et taux CSAT, objectif, tendance d'une enquête à l'autre, saisie
 * valide, tendance mensuelle des réclamations.
 */

import { canManageControls, type MembershipRole } from './authz.ts';
import { addMonthsIso } from './dates.ts';

export const SURVEY_METHODS = ['nps', 'csat'] as const;
export type SurveyMethod = (typeof SURVEY_METHODS)[number];

export const SURVEY_METHOD_LABEL: Record<SurveyMethod, string> = {
  nps: 'NPS — recommandation',
  csat: 'CSAT — satisfaction',
};

/** Fenêtre glissante des indicateurs de satisfaction et de réclamations. */
export const SATISFACTION_WINDOW_MONTHS = 12;
/** Écart, en points, en deçà duquel deux mesures sont jugées stables. */
export const SURVEY_TREND_THRESHOLD = 3;

export function canManageSatisfaction(role: MembershipRole): boolean {
  return canManageControls(role);
}

export interface SurveyResults {
  method: SurveyMethod;
  respondents: number;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  satisfied: number | null;
}

/** NPS : promoteurs moins détracteurs, en points de pourcentage (de -100 à 100). */
export function npsScore(promoters: number, passives: number, detractors: number): number {
  const total = promoters + passives + detractors;
  return total === 0 ? 0 : Math.round((100 * (promoters - detractors)) / total);
}

/** CSAT : part des répondants satisfaits, en pourcentage. */
export function csatRate(satisfied: number, respondents: number): number {
  return respondents === 0 ? 0 : Math.round((100 * satisfied) / respondents);
}

export function surveyScore(s: SurveyResults): number {
  return s.method === 'nps'
    ? npsScore(s.promoters ?? 0, s.passives ?? 0, s.detractors ?? 0)
    : csatRate(s.satisfied ?? 0, s.respondents);
}

export type SurveyVerdict = 'atteint' | 'sous_objectif' | 'sans_objectif';

export const SURVEY_VERDICT_LABEL: Record<SurveyVerdict, string> = {
  atteint: 'Objectif atteint',
  sous_objectif: 'Sous l’objectif',
  sans_objectif: 'Sans objectif',
};

export function surveyVerdict(score: number, target: number | null): SurveyVerdict {
  if (target === null) return 'sans_objectif';
  return score >= target ? 'atteint' : 'sous_objectif';
}

export type SurveyTrend = 'hausse' | 'baisse' | 'stable';

/** Tendance par rapport à la mesure précédente de même méthode et même segment. */
export function surveyTrend(score: number, previous: number | null): SurveyTrend | null {
  if (previous === null) return null;
  const delta = score - previous;
  if (Math.abs(delta) < SURVEY_TREND_THRESHOLD) return 'stable';
  return delta > 0 ? 'hausse' : 'baisse';
}

/** Motif de refus d'une enquête, ou null si elle peut être enregistrée. */
export function surveyError(
  input: SurveyResults & { closedOn: string; invitedCount: number | null; target: number | null },
  today: string,
): string | null {
  if (input.closedOn > today) return 'Une enquête se consigne une fois close : sa date de clôture ne peut pas être future.';
  if (!Number.isInteger(input.respondents) || input.respondents < 1) return 'Indiquez le nombre de répondants (1 au moins).';
  if (input.invitedCount !== null && input.respondents > input.invitedCount) {
    return 'Le nombre de répondants ne peut pas dépasser celui des personnes sollicitées.';
  }
  if (input.method === 'nps') {
    const parts = [input.promoters, input.passives, input.detractors];
    if (parts.some((p) => p === null || !Number.isInteger(p) || p < 0)) {
      return 'Indiquez le nombre de promoteurs, de passifs et de détracteurs.';
    }
    if ((input.promoters ?? 0) + (input.passives ?? 0) + (input.detractors ?? 0) !== input.respondents) {
      return 'Promoteurs, passifs et détracteurs doivent totaliser le nombre de répondants.';
    }
    if (input.target !== null && (input.target < -100 || input.target > 100)) return 'Un objectif NPS se situe entre -100 et 100.';
    return null;
  }
  if (input.satisfied === null || !Number.isInteger(input.satisfied) || input.satisfied < 0) return 'Indiquez le nombre de répondants satisfaits.';
  if (input.satisfied > input.respondents) return 'Les satisfaits ne peuvent pas dépasser les répondants.';
  if (input.target !== null && (input.target < 0 || input.target > 100)) return 'Un objectif CSAT s’exprime en pourcentage, de 0 à 100.';
  return null;
}

/** Réclamations par mois sur la fenêtre, du plus ancien au plus récent (mois au format AAAA-MM). */
export function monthlyComplaints(openedOn: readonly string[], today: string, months = SATISFACTION_WINDOW_MONTHS): { month: string; count: number }[] {
  const out: { month: string; count: number }[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    out.push({ month: addMonthsIso(`${today.slice(0, 7)}-01`, -i).slice(0, 7), count: 0 });
  }
  const index = new Map(out.map((m, i) => [m.month, i]));
  for (const d of openedOn) {
    const i = index.get(d.slice(0, 7));
    if (i !== undefined) out[i]!.count += 1;
  }
  return out;
}

/** Réclamations ouvertes sur les douze derniers mois, et sur les douze mois précédents. */
export function complaintsTrend(openedOn: readonly string[], today: string): { current: number; previous: number } {
  const since = addMonthsIso(today, -SATISFACTION_WINDOW_MONTHS);
  const before = addMonthsIso(today, -2 * SATISFACTION_WINDOW_MONTHS);
  return {
    current: openedOn.filter((d) => d > since && d <= today).length,
    previous: openedOn.filter((d) => d > before && d <= since).length,
  };
}
