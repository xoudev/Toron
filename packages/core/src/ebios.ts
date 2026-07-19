// ── Ateliers EBIOS RM (module 5.4b, méthode ANSSI) ─────────────────────
// EBIOS Risk Manager : cinq ateliers. Le cœur opérant est l'atelier 4 —
// scénarios opérationnels construits en kill chain « Connaître → Rentrer →
// Trouver → Exploiter ». La vraisemblance se DÉRIVE de la complétude des
// phases (fonction pure, testée). L'atelier 5 génère le risque dans le
// registre unique. EBIOS RM et MITRE ATT&CK sont publics.

export type EbiosPhase = 'connaitre' | 'rentrer' | 'trouver' | 'exploiter';
export type EbiosLikelihood = 'v1' | 'v2' | 'v3' | 'v4';
export type ScenarioStatus = 'a_faire' | 'en_cours' | 'cote';

export interface EbiosWorkshop {
  num: number;
  label: string;
}

/** Les cinq ateliers EBIOS RM (reformulations maison des intitulés ANSSI). */
export const EBIOS_WORKSHOPS: readonly EbiosWorkshop[] = [
  { num: 1, label: 'Cadrage et socle de sécurité' },
  { num: 2, label: 'Sources de risque' },
  { num: 3, label: 'Scénarios stratégiques' },
  { num: 4, label: 'Scénarios opérationnels' },
  { num: 5, label: 'Traitement du risque' },
];

/** Phases de la kill chain, dans l'ordre. */
export const KILL_CHAIN_PHASES: { key: EbiosPhase; label: string }[] = [
  { key: 'connaitre', label: 'Connaître' },
  { key: 'rentrer', label: 'Rentrer' },
  { key: 'trouver', label: 'Trouver' },
  { key: 'exploiter', label: 'Exploiter' },
];

export const LIKELIHOOD_LABEL: Record<EbiosLikelihood, string> = {
  v1: 'Minime',
  v2: 'Significative',
  v3: 'Forte',
  v4: 'Quasi-certaine',
};

/** Valeur numérique 1..4 de la vraisemblance (pour la cotation du risque). */
export function likelihoodValue(l: EbiosLikelihood): number {
  return { v1: 1, v2: 2, v3: 3, v4: 4 }[l];
}

/**
 * Dérive la vraisemblance d'un scénario opérationnel de la complétude de sa
 * kill chain : plus les phases sont renseignées, plus le mode opératoire est
 * plausible. Aucune phase → null (à construire). Chaque phase renseignée
 * affine la cotation.
 */
export function deriveScenarioLikelihood(phasesWithActions: Set<EbiosPhase> | EbiosPhase[]): EbiosLikelihood | null {
  const set = phasesWithActions instanceof Set ? phasesWithActions : new Set(phasesWithActions);
  const count = KILL_CHAIN_PHASES.filter((p) => set.has(p.key)).length;
  if (count === 0) return null;
  if (count >= 4) return 'v3';
  if (count === 3) return 'v2';
  return 'v1';
}

/** Statut d'un scénario : à faire (kill chain vide), en cours, ou coté. */
export function scenarioStatus(input: { likelihood: EbiosLikelihood | null; actionCount: number }): ScenarioStatus {
  if (input.likelihood !== null) return 'cote';
  if (input.actionCount > 0) return 'en_cours';
  return 'a_faire';
}

export const SCENARIO_STATUS_LABEL: Record<ScenarioStatus, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  cote: 'Coté',
};

/**
 * Cotation du risque généré à l'atelier 5 depuis un scénario opérationnel.
 * La vraisemblance alimente la valeur (V) ; la gravité (G) est reprise du
 * niveau d'impact estimé (défaut fort pour un scénario opérationnel abouti).
 * On rend une cotation brute = nette (le traitement viendra ensuite).
 */
export function scenarioRiskRating(likelihood: EbiosLikelihood, gravity = 3): { g: number; v: number } {
  return { g: gravity, v: likelihoodValue(likelihood) };
}
