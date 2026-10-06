/**
 * Règles métier du coffre de preuves (module 5.7). Pures et testées.
 * RM §5.7 : une preuve expirée SIGNALE (elle ne change pas le statut des
 * exigences couvertes — l'humain décide, l'outil signale).
 */

export const EVIDENCE_TYPES = ['capture', 'export', 'attestation', 'rapport', 'pv'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_RECURRENCES = [
  'ponctuelle',
  'trimestrielle',
  'semestrielle',
  'annuelle',
] as const;
export type EvidenceRecurrence = (typeof EVIDENCE_RECURRENCES)[number];

/** États de fraîcheur, du plus urgent au plus sain (ordre = priorité de tri). */
export const FRESHNESS_STATES = ['expiree', 'bientot', 'fraiche', 'permanente'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

/** Fenêtre « bientôt expirée » : 30 jours avant l'échéance. */
export const EXPIRING_SOON_DAYS = 30;

function toDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 86_400_000;

/**
 * Fraîcheur d'une preuve d'après sa date de validité :
 * - pas d'échéance ⇒ `permanente` ;
 * - échéance passée ⇒ `expiree` ;
 * - échéance dans ≤ 30 jours ⇒ `bientot` ;
 * - sinon ⇒ `fraiche`.
 */
export function freshnessState(validUntil: Date | null, today: Date): FreshnessState {
  if (!validUntil) return 'permanente';
  const diffDays = (toDay(validUntil) - toDay(today)) / DAY_MS;
  if (diffDays < 0) return 'expiree';
  if (diffDays <= EXPIRING_SOON_DAYS) return 'bientot';
  return 'fraiche';
}

/** Rang de tri « expirées d'abord » (0 = expirée … 3 = permanente). */
export function freshnessRank(state: FreshnessState): number {
  return FRESHNESS_STATES.indexOf(state);
}

/** true si l'état doit attirer l'attention (expirée ou bientôt). */
export function freshnessNeedsAttention(state: FreshnessState): boolean {
  return state === 'expiree' || state === 'bientot';
}

const RECURRENCE_MONTHS: Record<EvidenceRecurrence, number | null> = {
  ponctuelle: null,
  trimestrielle: 3,
  semestrielle: 6,
  annuelle: 12,
};

/**
 * Validité proposée pour une preuve collectée à `collectedAt` (AAAA-MM-JJ)
 * selon sa récurrence ; null pour une preuve ponctuelle. Le jour est borné au
 * dernier jour du mois d'arrivée (31/01 + 1 mois → 28 ou 29/02).
 */
export function suggestedValidUntil(collectedAt: string, recurrence: EvidenceRecurrence): string | null {
  const months = RECURRENCE_MONTHS[recurrence];
  if (months === null) return null;
  const [y, m, d] = collectedAt.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d!, lastDay));
  return target.toISOString().slice(0, 10);
}
