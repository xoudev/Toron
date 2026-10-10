// Modèle du rapport de direction scellé, indépendant du template. Assemblé
// par le worker à partir du rapport calculé (loadBoardReport). Rendu par
// board-template.

export interface BoardModel {
  organisationName: string;
  headline: string;
  situationLabel: string;
  generatedAtLabel: string;
  messages: { tone: 'alerte' | 'vigilance' | 'positif'; text: string }[];
  decisions: string[];
  kpis: { label: string; value: string }[];
  nis2: { title: string; detail: string }[];
  frameworks: string[];
  risks: { ref: string; title: string; level: string; treatment: string; owner: string }[] | null;
  /** Registre des risques vide : la section le dit, plutôt que de taire l'absence d'analyse. */
  riskRegisterEmpty?: boolean;
  overdueActions: { ref: string; title: string; priority: string; due: string; owner: string }[];
  // Poinçon (ADR-6)
  verifyUrl: string;
  verifySlug: string;
}
