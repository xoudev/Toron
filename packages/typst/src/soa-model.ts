// Modèle de données de la Déclaration d'applicabilité (SoA), indépendant
// du template. Assemblé par la couche d'accès (worker) à partir de la
// campagne d'évaluation, rendu par soa-template.

export interface SoaRow {
  ref: string;
  title: string;
  /** Libellé lisible du statut (Conforme, Écart, Non applicable, À évaluer). */
  status: string;
  included: boolean;
  justification: string | null;
}

export interface SoaModel {
  frameworkName: string;
  entityName: string;
  scopeName: string;
  generatedAtLabel: string;
  /** Pourcentage de couverture, ou null si aucune exigence applicable. */
  coveragePct: number | null;
  gaps: number;
  rows: SoaRow[];
  // Poinçon (ADR-6)
  verifyUrl: string;
  verifySlug: string;
}
