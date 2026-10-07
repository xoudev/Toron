/**
 * Sensibilisation et formation (ISO 27001 A.6.3, ISO 9001 7.2 et 7.3,
 * NIS 2 art. 20). Règles pures : état d'une session, formation des
 * dirigeants à jour, bilan sur douze mois, saisie valide.
 */

import { canManageControls, type MembershipRole } from './authz.ts';
import { addMonthsIso } from './dates.ts';
import { daysUntil } from './work.ts';

export const TRAINING_KINDS = ['sensibilisation', 'formation_dirigeants', 'phishing', 'rgpd', 'qualite', 'metier'] as const;
export type TrainingKind = (typeof TRAINING_KINDS)[number];

export const TRAINING_KIND_LABEL: Record<TrainingKind, string> = {
  sensibilisation: 'Sensibilisation à la sécurité',
  formation_dirigeants: 'Formation des dirigeants (NIS 2)',
  phishing: 'Exercice d’hameçonnage',
  rgpd: 'Protection des données (RGPD)',
  qualite: 'Qualité',
  metier: 'Formation métier',
};

/**
 * Validité d'une formation des dirigeants. NIS 2 (art. 20) impose une
 * formation des membres de la direction sans fixer de périodicité ; Toron
 * propose une mise à jour annuelle, rythme courant des plans de formation.
 */
export const LEADER_TRAINING_MONTHS = 12;
/** Délai avant l'échéance où le renouvellement est à planifier. */
export const LEADER_TRAINING_SOON_DAYS = 60;
/** Fenêtre glissante des indicateurs de sensibilisation. */
export const AWARENESS_WINDOW_MONTHS = 12;

/** Rôles des organes de direction au sens de NIS 2. */
export const LEADER_ROLES: readonly MembershipRole[] = ['owner', 'direction'];

export function isLeaderRole(role: MembershipRole): boolean {
  return LEADER_ROLES.includes(role);
}

export type TrainingSessionState = 'a_venir' | 'realisee';

export const TRAINING_SESSION_STATE_LABEL: Record<TrainingSessionState, string> = {
  a_venir: 'À venir',
  realisee: 'Réalisée',
};

/** Planifier et enregistrer des sessions : les rôles qui gèrent les contrôles, pas le lecteur ni l'auditeur. */
export function canManageTraining(role: MembershipRole): boolean {
  return canManageControls(role);
}

export function trainingSessionState(heldOn: string, today: string): TrainingSessionState {
  return heldOn > today ? 'a_venir' : 'realisee';
}

export type LeaderTrainingState = 'a_jour' | 'bientot' | 'a_renouveler' | 'jamais';

export const LEADER_TRAINING_STATE_LABEL: Record<LeaderTrainingState, string> = {
  a_jour: 'À jour',
  bientot: 'À renouveler bientôt',
  a_renouveler: 'À renouveler',
  jamais: 'Jamais formé',
};

/** Échéance du renouvellement d'une formation des dirigeants. */
export function leaderTrainingDue(lastTrainedOn: string): string {
  return addMonthsIso(lastTrainedOn, LEADER_TRAINING_MONTHS);
}

/** Formation d'un dirigeant à une date, d'après sa dernière session « dirigeants » réalisée. */
export function leaderTrainingState(lastTrainedOn: string | null, today: string): LeaderTrainingState {
  if (!lastTrainedOn) return 'jamais';
  const days = daysUntil(leaderTrainingDue(lastTrainedOn), today);
  if (days < 0) return 'a_renouveler';
  return days <= LEADER_TRAINING_SOON_DAYS ? 'bientot' : 'a_jour';
}

export interface LeaderTrainingCounts {
  leaders: number;
  /** Formation valable, y compris à renouveler bientôt. */
  upToDate: number;
  dueSoon: number;
  /** Formation échue ou jamais suivie. */
  untrained: number;
}

/** Dirigeants par état de formation, pour le pilotage. */
export function leaderTrainingCounts(states: readonly LeaderTrainingState[]): LeaderTrainingCounts {
  return {
    leaders: states.length,
    upToDate: states.filter((st) => st === 'a_jour' || st === 'bientot').length,
    dueSoon: states.filter((st) => st === 'bientot').length,
    untrained: states.filter((st) => st === 'a_renouveler' || st === 'jamais').length,
  };
}

export interface AwarenessSession {
  heldOn: string;
  expectedCount: number | null;
  attendedCount: number | null;
  evidenceId: string | null;
}

export interface AwarenessSummary {
  /** Sessions tenues sur les douze derniers mois. */
  held: number;
  /** Participations à ces sessions : une même personne peut compter plusieurs fois. */
  participations: number;
  /** Présents rapportés aux attendus, en %, sur les sessions où les deux sont connus. */
  attendanceRate: number | null;
  /** Sessions tenues sans feuille d'émargement ni attestation au coffre de preuves. */
  withoutSheet: number;
  /** Sessions planifiées, et la date de la prochaine. */
  upcoming: number;
  nextOn: string | null;
}

/** Bilan de la sensibilisation sur les douze derniers mois. */
export function awarenessSummary(sessions: readonly AwarenessSession[], today: string): AwarenessSummary {
  const since = addMonthsIso(today, -AWARENESS_WINDOW_MONTHS);
  const held = sessions.filter((s) => s.heldOn <= today && s.heldOn > since);
  let expected = 0;
  let present = 0;
  for (const s of held) {
    if (s.expectedCount && s.attendedCount !== null) {
      expected += s.expectedCount;
      present += s.attendedCount;
    }
  }
  const upcoming = sessions.filter((s) => s.heldOn > today).map((s) => s.heldOn).sort();
  return {
    held: held.length,
    participations: held.reduce((sum, s) => sum + (s.attendedCount ?? 0), 0),
    attendanceRate: expected > 0 ? Math.round((100 * present) / expected) : null,
    withoutSheet: held.filter((s) => s.evidenceId === null).length,
    upcoming: upcoming.length,
    nextOn: upcoming[0] ?? null,
  };
}

/** Motif de refus d'une session, ou null si elle peut être enregistrée. */
export function trainingSessionError(
  input: { heldOn: string; expectedCount: number | null; attendedCount: number | null; attendeeCount: number },
  today: string,
): string | null {
  if (input.heldOn > today && (input.attendedCount !== null || input.attendeeCount > 0)) {
    return 'Une session à venir n’a pas encore de participants : enregistrez la présence une fois la session tenue.';
  }
  if (input.attendedCount !== null && input.attendedCount < input.attendeeCount) {
    return 'Le nombre de présents ne peut pas être inférieur au nombre de membres cochés comme présents.';
  }
  return null;
}
