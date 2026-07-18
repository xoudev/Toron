/**
 * Règles métier du moteur de référentiels & cross-mapping (module 5.2).
 * Pures et testées — l'UI et la couche d'accès ne font que les invoquer
 * (PLAN §13 : la logique ne vit jamais dans les composants React).
 */

/** Une exigence couverte par un contrôle, avec son référentiel d'origine. */
export interface CoveredRequirement {
  frameworkId: string;
  frameworkCode: string;
  frameworkName: string;
  requirementId: string;
  requirementRef: string;
  requirementTitle: string;
  /** Nombre d'AUTRES contrôles couvrant déjà cette exigence (hors celui considéré). */
  otherControlsCount: number;
}

/** Codes des référentiels distincts couverts, triés — déterministe. */
export function frameworksCovered(reqs: readonly CoveredRequirement[]): string[] {
  return [...new Set(reqs.map((r) => r.frameworkCode))].sort();
}

/**
 * Un contrôle est « mutualisé » dès qu'il couvre au moins deux référentiels
 * distincts (P1) — c'est ce que compte la vue mutualized_controls.
 */
export function isMutualized(reqs: readonly CoveredRequirement[]): boolean {
  return frameworksCovered(reqs).length >= 2;
}

export interface ImpactedRequirement {
  requirementId: string;
  requirementRef: string;
  requirementTitle: string;
  /** true si ce contrôle est le dernier à couvrir l'exigence : elle deviendrait « découverte ». */
  becomesUncovered: boolean;
}

export interface FrameworkImpact {
  frameworkId: string;
  frameworkCode: string;
  frameworkName: string;
  requirements: ImpactedRequirement[];
}

/**
 * Impact de la suppression d'un contrôle (RM §5.2 : « supprimer un contrôle
 * mappé exige confirmation listant les exigences découvertes »).
 * Résultat groupé par référentiel, avec le décompte des exigences qui
 * perdraient leur seule couverture — la décision reste humaine (S5).
 */
export interface ControlDeleteImpact {
  mappedRequirementCount: number;
  /** true dès qu'au moins une exigence est couverte : l'UI doit confirmer avant suppression. */
  requiresConfirmation: boolean;
  /** Exigences qui n'auraient plus aucun contrôle après la suppression. */
  uncoveredRequirementCount: number;
  frameworks: FrameworkImpact[];
}

export function controlDeleteImpact(
  reqs: readonly CoveredRequirement[],
): ControlDeleteImpact {
  const byFramework = new Map<string, FrameworkImpact>();
  let uncoveredRequirementCount = 0;

  for (const r of reqs) {
    const becomesUncovered = r.otherControlsCount === 0;
    if (becomesUncovered) uncoveredRequirementCount += 1;

    let group = byFramework.get(r.frameworkId);
    if (!group) {
      group = {
        frameworkId: r.frameworkId,
        frameworkCode: r.frameworkCode,
        frameworkName: r.frameworkName,
        requirements: [],
      };
      byFramework.set(r.frameworkId, group);
    }
    group.requirements.push({
      requirementId: r.requirementId,
      requirementRef: r.requirementRef,
      requirementTitle: r.requirementTitle,
      becomesUncovered,
    });
  }

  const frameworks = [...byFramework.values()].sort((a, b) =>
    a.frameworkCode.localeCompare(b.frameworkCode),
  );
  for (const group of frameworks) {
    group.requirements.sort((a, b) => a.requirementRef.localeCompare(b.requirementRef));
  }

  return {
    mappedRequirementCount: reqs.length,
    requiresConfirmation: reqs.length > 0,
    uncoveredRequirementCount,
    frameworks,
  };
}
