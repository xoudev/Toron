// Modèle du livrable EBIOS RM (étude + scénarios opérationnels + kill chains),
// indépendant du template. Assemblé par le worker depuis l'étude. Rendu par
// ebios-template. EBIOS RM et MITRE ATT&CK sont publics.

export interface EbiosPhaseBlock {
  label: string;
  actions: { tech: string | null; label: string }[];
}

export interface EbiosScenarioBlock {
  riskSource: string;
  targetObjective: string;
  likelihoodLabel: string; // ex. « V3 · Forte » ou « — »
  generated: boolean;
  phases: EbiosPhaseBlock[];
}

export interface EbiosModel {
  title: string;
  entityName: string;
  scopeLabel: string;
  workshopLabel: string;
  generatedAtLabel: string;
  scenarios: EbiosScenarioBlock[];
  // Poinçon (ADR-6)
  verifyUrl: string;
  verifySlug: string;
}
