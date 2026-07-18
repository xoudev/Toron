/**
 * Règles métier des évaluations & gap analysis (module 5.3).
 * Pures et testées — l'UI et la couche d'accès les invoquent (PLAN §13).
 */

export const ASSESSMENT_ITEM_STATUSES = [
  'conforme',
  'ecart',
  'non_applicable',
  'a_evaluer',
] as const;

export type AssessmentItemStatus = (typeof ASSESSMENT_ITEM_STATUSES)[number];

export interface StatusCounts {
  conforme: number;
  ecart: number;
  non_applicable: number;
  a_evaluer: number;
}

export interface CoverageScore {
  total: number;
  /** Exigences retenues dans le score : tout sauf les non applicables (RM §5.3). */
  applicable: number;
  counts: StatusCounts;
  /** conforme / applicable en pourcentage arrondi ; null si aucune exigence applicable. */
  scorePct: number | null;
  /** Nombre d'écarts (statut = ecart) — l'indicateur d'action du gap analysis. */
  gaps: number;
}

/** Décompte des statuts d'un ensemble d'items d'évaluation. */
export function countStatuses(items: readonly { status: AssessmentItemStatus }[]): StatusCounts {
  const counts: StatusCounts = { conforme: 0, ecart: 0, non_applicable: 0, a_evaluer: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/**
 * Score de couverture d'une campagne (RM §5.3) : le pourcentage de
 * conformité ne compte JAMAIS les non applicables au dénominateur. Les
 * exigences « à évaluer » restent applicables (elles pèsent sur le score
 * tant qu'elles ne sont pas conformes) — le score reflète l'avancement réel.
 */
export function scoreAssessment(items: readonly { status: AssessmentItemStatus }[]): CoverageScore {
  const counts = countStatuses(items);
  const total = items.length;
  const applicable = total - counts.non_applicable;
  return {
    total,
    applicable,
    counts,
    scorePct: applicable === 0 ? null : Math.round((counts.conforme / applicable) * 100),
    gaps: counts.ecart,
  };
}

/**
 * Justification obligatoire pour une exclusion (statut « non applicable »)
 * — reflète la contrainte CHECK en base, réutilisable pour valider côté
 * client avant l'aller-retour serveur (S2).
 */
export function soaJustificationRequired(status: AssessmentItemStatus): boolean {
  return status === 'non_applicable';
}

export interface SoaItemInput {
  status: AssessmentItemStatus;
  soaJustification?: string | null;
}

/** true si l'item respecte la règle « N/A ⇒ justification non vide » (RM §5.3). */
export function isSoaItemValid(input: SoaItemInput): boolean {
  if (!soaJustificationRequired(input.status)) return true;
  return typeof input.soaJustification === 'string' && input.soaJustification.trim().length > 0;
}

/**
 * Une exigence d'un AUTRE référentiel, couverte par le même contrôle que
 * l'exigence source, et son statut actuel dans sa propre campagne (null si
 * aucune campagne ne la porte).
 */
export interface MutualizedPeer {
  requirementId: string;
  requirementRef: string;
  frameworkCode: string;
  frameworkName: string;
  viaControlTitle: string;
  currentStatus: AssessmentItemStatus | null;
}

export interface StatusSuggestion {
  requirementId: string;
  requirementRef: string;
  frameworkCode: string;
  frameworkName: string;
  suggestedStatus: AssessmentItemStatus;
  /** Traçabilité affichée à l'humain qui valide (RM §5.3, décision 2026-07-18). */
  reason: string;
}

/**
 * Héritage de statut via un contrôle mutualisé (RM §5.3) — en SUGGESTION,
 * jamais en propagation automatique : « Prouvez une fois. Couvrez tout. »
 * mais l'humain valide (auditable > magique).
 *
 * Ne suggère que lorsque la source est CONFORME (le contrôle satisfait
 * réellement l'exigence). N'écrase jamais une exclusion (non applicable) ni
 * un statut déjà conforme du pair. La traçabilité pointe vers l'exigence
 * source et le contrôle partagé.
 */
export function suggestInheritedStatuses(
  source: { status: AssessmentItemStatus; requirementRef: string },
  peers: readonly MutualizedPeer[],
): StatusSuggestion[] {
  if (source.status !== 'conforme') return [];
  const suggestions: StatusSuggestion[] = [];
  for (const peer of peers) {
    if (peer.currentStatus === 'conforme' || peer.currentStatus === 'non_applicable') continue;
    suggestions.push({
      requirementId: peer.requirementId,
      requirementRef: peer.requirementRef,
      frameworkCode: peer.frameworkCode,
      frameworkName: peer.frameworkName,
      suggestedStatus: 'conforme',
      reason: `Couvert par le contrôle « ${peer.viaControlTitle} », déjà conforme pour ${source.requirementRef}.`,
    });
  }
  return suggestions;
}
