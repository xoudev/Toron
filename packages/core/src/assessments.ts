/**
 * Règles métier des évaluations & gap analysis (module 5.3).
 * Pures et testées — l'UI et la couche d'accès les invoquent (PLAN §13).
 */

import type { Nis2Qualification } from './obligations.ts';

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
 * La Déclaration d'applicabilité peut-elle être scellée ? Il faut au moins
 * une exigence applicable évaluée (conforme ou écart). Les exclusions posées
 * à la création de la campagne (ex. moyens ReCyF réservés aux entités
 * essentielles) ne comptent pas : sans évaluation humaine, le PDF scellé ne
 * contiendrait que des « à évaluer ».
 */
export function soaExportReady(score: CoverageScore): boolean {
  return score.counts.conforme + score.counts.ecart > 0;
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
 * Colonnes SoA dérivées du statut, calculées côté serveur : une exigence est
 * incluse dans la Déclaration d'applicabilité sauf exclusion (non
 * applicable), et seule une exclusion garde sa justification — une exigence
 * repassée de N/A à conforme n'imprime plus l'ancienne justification.
 */
export function normalizeSoaItem(
  status: AssessmentItemStatus,
  justification: string | null | undefined,
): { soaIncluded: boolean; soaJustification: string | null } {
  const excluded = status === 'non_applicable';
  const text = justification?.trim() ?? '';
  return { soaIncluded: !excluded, soaJustification: excluded && text.length > 0 ? text : null };
}

/**
 * Une exigence peut-elle être exclue (non applicable) ? ISO/IEC 27001 :
 * seules les mesures de l'Annexe A s'excluent ; les clauses 4 à 10 du
 * système de management sont toutes exigées pour la certification. Les
 * autres référentiels admettent l'exclusion justifiée.
 */
export function exclusionAllowed(frameworkCode: string, ref: string): boolean {
  if (frameworkCode === 'iso27001') return ref.startsWith('A.');
  return true;
}

/** Catégorie NIS 2 retenue pour une campagne ReCyF : entité importante ou essentielle. */
export type RecyfEntityKind = 'ei' | 'ee';

/**
 * Catégorie proposée au lancement d'une campagne ReCyF, d'après la
 * qualification NIS 2 des entités juridiques : essentielle dès qu'une entité
 * l'est, importante si une l'est, inconnue (null) sinon — l'évaluateur choisit.
 */
export function recyfEntityKindDefault(statuses: readonly Nis2Qualification['status'][]): RecyfEntityKind | null {
  if (statuses.includes('ee')) return 'ee';
  if (statuses.includes('ei')) return 'ei';
  return null;
}

/** Applicabilité d'un moyen ReCyF par catégorie d'entité (données du référentiel). */
export interface RecyfMeanApplicability {
  ref: string;
  ei: boolean;
  ee: boolean;
}

/**
 * Moyens ReCyF qui ne concernent pas la catégorie d'entité (pour une entité
 * importante : ceux réservés aux entités essentielles). Ils entrent dans la
 * campagne déjà exclus, avec une justification générée que l'évaluateur
 * peut reprendre — ils ne pèsent plus sur le score (RM §5.3).
 */
export function recyfPreExclusions(
  means: readonly RecyfMeanApplicability[],
  entity: RecyfEntityKind,
  version: string,
): { refs: string[]; justification: string } {
  const label = `ReCyF v${version.replace(/^v/i, '')}`;
  return {
    refs: means.filter((m) => (entity === 'ei' ? !m.ei : !m.ee)).map((m) => m.ref),
    justification:
      entity === 'ei'
        ? `Mesure exigée des seules entités essentielles (${label}) — organisation qualifiée entité importante.`
        : `Mesure exigée des seules entités importantes (${label}) — organisation qualifiée entité essentielle.`,
  };
}

/**
 * Une exigence d'un AUTRE référentiel, couverte par le même contrôle que
 * l'exigence source, et son statut actuel dans sa propre campagne (null si
 * aucune campagne ne la porte).
 */
export interface MutualizedPeer {
  requirementId: string;
  requirementRef: string;
  frameworkId: string;
  frameworkCode: string;
  frameworkName: string;
  viaControlTitle: string;
  currentStatus: AssessmentItemStatus | null;
  /** true si la campagne qui porte currentStatus est en cours (une campagne clôturée est figée). */
  campaignOpen: boolean;
}

export interface StatusSuggestion {
  requirementId: string;
  requirementRef: string;
  frameworkId: string;
  frameworkCode: string;
  frameworkName: string;
  suggestedStatus: AssessmentItemStatus;
  /** Traçabilité affichée à l'humain qui valide (RM §5.3, décision 2026-07-18). */
  reason: string;
  /** false si aucune campagne en cours ne porte l'exigence du pair : rien à hériter pour l'instant. */
  hasCampaign: boolean;
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
      frameworkId: peer.frameworkId,
      frameworkCode: peer.frameworkCode,
      frameworkName: peer.frameworkName,
      suggestedStatus: 'conforme',
      reason: `Couvert par le contrôle « ${peer.viaControlTitle} », déjà conforme pour ${source.requirementRef}.`,
      hasCampaign: peer.campaignOpen,
    });
  }
  return suggestions;
}
