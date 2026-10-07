/**
 * Règles métier du moteur de risques (module 5.4, registre manuel).
 * Pures et testées — la couche d'accès et l'UI les invoquent (PLAN §13).
 * EBIOS RM guidé = phase V1 (hors de ce module).
 */

export const RISK_TREATMENTS = ['reduire', 'transferer', 'accepter', 'eviter'] as const;
export type RiskTreatment = (typeof RISK_TREATMENTS)[number];

/** Bandes de la matrice, ordonnées du plus faible au pire. */
export const RISK_BANDS = ['faible', 'moyen', 'eleve', 'critique'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/** Rang d'une bande (0 = faible … 3 = critique) — pour trier/comparer. */
export function bandRank(band: RiskBand): number {
  return RISK_BANDS.indexOf(band);
}

/**
 * Échelle G/V d'un tenant : taille de la matrice, libellés des niveaux et
 * bande de risque de chaque cellule. `bands[g-1][v-1]` donne la bande pour la
 * gravité g et la vraisemblance v (indices 1..size).
 */
export interface RiskScale {
  size: number;
  gLabels: string[];
  vLabels: string[];
  bands: RiskBand[][];
}

/**
 * Échelle 4×4 par défaut (matrice monotone standard). Sert de socle au seed
 * et de repli quand un tenant n'a pas encore défini d'échelle. Libellés issus
 * de méthodes publiques (aucune reproduction de norme sous copyright).
 */
export function defaultRiskScale(): RiskScale {
  return {
    size: 4,
    gLabels: ['Négligeable', 'Limitée', 'Importante', 'Critique'],
    vLabels: ['Minimale', 'Significative', 'Forte', 'Maximale'],
    bands: [
      ['faible', 'faible', 'moyen', 'moyen'], // gravité 1
      ['faible', 'moyen', 'moyen', 'eleve'], // gravité 2
      ['moyen', 'moyen', 'eleve', 'critique'], // gravité 3
      ['moyen', 'eleve', 'critique', 'critique'], // gravité 4
    ],
  };
}

/**
 * Bande de risque d'une cotation (g, v) sur une échelle. Renvoie null si la
 * cotation sort de la matrice (garde-fou : une échelle réduite ne doit pas
 * faire planter l'affichage d'anciennes cotations plus élevées).
 */
export function riskBand(g: number, v: number, scale: RiskScale): RiskBand | null {
  if (!Number.isInteger(g) || !Number.isInteger(v)) return null;
  if (g < 1 || v < 1 || g > scale.size || v > scale.size) return null;
  return scale.bands[g - 1]?.[v - 1] ?? null;
}

/** Score brut d'une cotation (produit G×V) — sert au tri, pas à la bande. */
export function riskScore(g: number, v: number): number {
  return g * v;
}

export const ACCEPTANCE_STATES = ['non_requise', 'en_attente', 'acceptee', 'expiree'] as const;
export type AcceptanceState = (typeof ACCEPTANCE_STATES)[number];

export interface AcceptanceInput {
  treatment: RiskTreatment;
  /** Acceptation en vigueur (la plus récente), ou null si aucune. */
  acceptance: { acceptedAt: Date; expiresAt: Date | null } | null;
}

/**
 * État d'acceptation d'un risque (RM §5.4).
 *
 * - Traitement ≠ « accepter » ⇒ `non_requise` (pas d'acceptation formelle attendue).
 * - « accepter » sans acceptation signée ⇒ `en_attente` : le risque doit être
 *   remonté en revue de direction (l'outil signale, il ne masque pas).
 * - « accepter » avec acceptation valide ⇒ `acceptee`.
 * - « accepter » avec acceptation dont l'échéance de revalidation est passée ⇒ `expiree`.
 */
export function acceptanceState(input: AcceptanceInput, now: Date): AcceptanceState {
  if (input.treatment !== 'accepter') return 'non_requise';
  const acc = input.acceptance;
  if (!acc) return 'en_attente';
  if (acc.expiresAt !== null && acc.expiresAt.getTime() < now.getTime()) return 'expiree';
  return 'acceptee';
}

/** true si l'état d'acceptation exige une action (à remonter en revue). */
export function acceptanceNeedsAttention(state: AcceptanceState): boolean {
  return state === 'en_attente' || state === 'expiree';
}

export const TREATMENT_PLAN_STATES = ['sans_objet', 'cible_atteinte', 'non_planifie', 'a_recoter', 'en_retard', 'en_cours'] as const;
export type TreatmentPlanState = (typeof TREATMENT_PLAN_STATES)[number];

export interface TreatmentPlanInput {
  treatment: RiskTreatment;
  netBand: RiskBand | null;
  residualTarget: RiskBand | null;
  /** Actions issues du risque non terminées (planifiées, en cours, en vérification). */
  openActions: number;
  /** Parmi elles, celles dont l'échéance est dépassée. */
  overdueActions: number;
  /** Actions issues du risque déjà terminées. */
  doneActions: number;
}

/**
 * Où en est le traitement d'un risque (RM §5.4 → §5.5).
 *
 * - « accepter » : le suivi passe par l'acceptation signée ⇒ `sans_objet`.
 * - Risque net déjà au niveau de la cible (ou en dessous) sans action ouverte ⇒ `cible_atteinte`.
 * - Actions toutes terminées mais cible non atteinte ⇒ `a_recoter` : le risque net
 *   doit être réévalué pour constater l'effet du traitement.
 * - Réduire / transférer / éviter sans aucune action ⇒ `non_planifie` :
 *   la décision de traitement n'a pas de traduction concrète.
 * - Au moins une action ouverte en retard ⇒ `en_retard`, sinon `en_cours`.
 */
export function treatmentPlanState(input: TreatmentPlanInput): TreatmentPlanState {
  if (input.treatment === 'accepter') return 'sans_objet';
  if (input.openActions === 0) {
    const reached =
      input.netBand !== null &&
      input.residualTarget !== null &&
      bandRank(input.netBand) <= bandRank(input.residualTarget);
    if (reached) return 'cible_atteinte';
    return input.doneActions > 0 ? 'a_recoter' : 'non_planifie';
  }
  return input.overdueActions > 0 ? 'en_retard' : 'en_cours';
}

/** true si le plan de traitement doit être remonté (rien de planifié ou du retard). */
export function treatmentPlanNeedsAttention(state: TreatmentPlanState): boolean {
  return state === 'non_planifie' || state === 'a_recoter' || state === 'en_retard';
}

/**
 * Priorité proposée pour une action de traitement, selon le niveau net du
 * risque : un risque critique ou élevé ne se traite pas en P3.
 */
export function treatmentActionPriority(netBand: RiskBand | null): 'p1' | 'p2' | 'p3' {
  if (netBand === 'critique' || netBand === 'eleve') return 'p1';
  if (netBand === 'faible') return 'p3';
  return 'p2';
}