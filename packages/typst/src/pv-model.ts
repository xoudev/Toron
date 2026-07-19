// Modèle du procès-verbal de revue de direction (clause 9.3), indépendant du
// template. Assemblé par le worker à partir de la séance, de ses décisions et
// de l'ordre du jour calculé (métriques réelles). Rendu par pv-template.

export interface PvAgendaEntry {
  n: number;
  clause: string;
  title: string;
  /** Ligne(s) de synthèse « données injectées ». */
  lines: string[];
}

export interface PvDecisionRow {
  body: string;
  /** Référence de l'action si la décision a été convertie, sinon null. */
  actionNote: string | null;
}

export interface PvModel {
  title: string;
  entityName: string;
  scopeLabel: string;
  heldAtLabel: string;
  generatedAtLabel: string;
  participants: string[];
  agenda: PvAgendaEntry[];
  decisions: PvDecisionRow[];
  nextReviewLabel: string | null;
  // Poinçon (ADR-6)
  verifyUrl: string;
  verifySlug: string;
}
