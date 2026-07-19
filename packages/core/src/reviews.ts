// ── Revue de direction (module 5.9, clause 9.3) ────────────────────────
// UNE seule revue couvre le SMSI (27001) et le QMS (9001). L'ordre du jour
// reprend les entrées obligatoires de la clause 9.3.2 (a→f) ; il est
// AUTO-GÉNÉRÉ à partir des données réelles du tenant — d'où ces fonctions
// pures, testables, qui transforment des métriques agrégées en sections
// d'ordre du jour. Aucun texte intégral de norme : identifiants de clause +
// reformulations maison uniquement.

export type ReviewStatus = 'planifie' | 'tenue' | 'close';
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['planifie', 'tenue', 'close'];

export type AgendaKind = 'actions' | 'kpi' | 'bullets';
export type Tone = 'ok' | 'warn' | 'danger' | 'muted';

export interface AgendaBullet {
  head: string;
  body: string;
  tone: Tone;
}

export interface AgendaKpi {
  label: string;
  value: string;
  trend?: string;
  tone: Tone;
}

export interface AgendaSection {
  n: number;
  /** Identifiant de clause 9.3.2 (a→f). */
  clause: string;
  title: string;
  kind: AgendaKind;
  /** Ligne de synthèse « données injectées ». */
  summary: string;
  bullets: AgendaBullet[];
  kpis: AgendaKpi[];
  /** true si la section a été alimentée par des données réelles. */
  hasData: boolean;
}

/** Métriques agrégées du tenant nécessaires à l'ordre du jour. */
export interface ReviewInputs {
  actionsOpen: number;
  actionsOverdue: number;
  coveragePct: number | null;
  gaps: number;
  incidentsOpen: number;
  auditsInProgress: number;
  auditsClosed: number;
  ncOpen: number;
  ncInEffectivenessCheck: number;
  risksHigh: number;
  risksTotal: number;
  controlsMutualized: number;
  evidencesStale: number;
  documentsReviewOverdue: number;
}

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n > 1 ? plural_ : singular}`;
}

/**
 * Construit l'ordre du jour de la revue de direction à partir des métriques
 * réelles du tenant. Les sections reprennent les entrées de la clause 9.3.2.
 */
export function buildReviewAgenda(m: ReviewInputs): AgendaSection[] {
  const coverage = m.coveragePct === null ? '—' : `${m.coveragePct} %`;

  return [
    {
      n: 1,
      clause: '9.3.2 a',
      title: 'Suivi des actions des revues précédentes',
      kind: 'actions',
      summary:
        m.actionsOpen === 0
          ? 'Toutes les actions décidées sont soldées.'
          : `${plural(m.actionsOpen, 'action en cours', 'actions en cours')}${
              m.actionsOverdue > 0 ? `, dont ${m.actionsOverdue} en retard` : ', sans dérive d’échéance'
            }.`,
      bullets: [],
      kpis: [],
      hasData: true,
    },
    {
      n: 2,
      clause: '9.3.2 b',
      title: 'Évolution des enjeux internes et externes',
      kind: 'bullets',
      summary: 'Contexte réglementaire et organisationnel depuis la dernière revue.',
      bullets: [
        { head: 'Externe —', body: 'entrée en application de NIS 2 / ReCyF : périmètre d’obligations à confirmer.', tone: 'warn' },
        { head: 'Interne —', body: 'évolutions du périmètre SMSI + QMS (sites, effectifs, activités) à acter.', tone: 'muted' },
      ],
      hasData: false,
      kpis: [],
    },
    {
      n: 3,
      clause: '9.3.2 c',
      title: 'Performance — indicateurs et tendances',
      kind: 'kpi',
      summary: 'Indicateurs clés du système de management.',
      kpis: [
        { label: 'COUVERTURE', value: coverage, tone: 'ok' },
        { label: 'ÉCARTS OUVERTS', value: String(m.gaps), tone: m.gaps > 0 ? 'warn' : 'ok' },
        { label: 'INCIDENTS OUVERTS', value: String(m.incidentsOpen), tone: m.incidentsOpen > 0 ? 'warn' : 'ok' },
        { label: 'CONTRÔLES MUTUALISÉS', value: String(m.controlsMutualized), tone: 'ok' },
      ],
      bullets: [],
      hasData: true,
    },
    {
      n: 4,
      clause: '9.3.2 c',
      title: 'Résultats d’audits et état des non-conformités',
      kind: 'bullets',
      summary: `${plural(m.auditsClosed, 'audit clôturé', 'audits clôturés')}, ${plural(m.auditsInProgress, 'audit en cours', 'audits en cours')}.`,
      bullets: [
        { head: 'Audits —', body: `${plural(m.auditsClosed, 'clôturé', 'clôturés')}, ${plural(m.auditsInProgress, 'en cours', 'en cours')}.`, tone: m.auditsInProgress > 0 ? 'warn' : 'ok' },
        { head: 'Non-conformités —', body: `${plural(m.ncOpen, 'ouverte', 'ouvertes')}, ${plural(m.ncInEffectivenessCheck, 'en vérification d’efficacité (J+90)', 'en vérification d’efficacité (J+90)')}.`, tone: m.ncOpen > 0 ? 'warn' : 'ok' },
      ],
      kpis: [],
      hasData: true,
    },
    {
      n: 5,
      clause: '9.3.2 e',
      title: 'Évolution des risques et du plan de traitement',
      kind: 'bullets',
      summary: `${plural(m.risksHigh, 'risque élevé/critique', 'risques élevés/critiques')} sur ${m.risksTotal}.`,
      bullets: [
        { head: 'Niveau de risque —', body: `${plural(m.risksHigh, 'risque élevé ou critique', 'risques élevés ou critiques')} sur ${plural(m.risksTotal, 'risque identifié', 'risques identifiés')}.`, tone: m.risksHigh > 0 ? 'danger' : 'ok' },
        { head: 'Opportunité —', body: `mutualisation de ${plural(m.controlsMutualized, 'contrôle', 'contrôles')} entre référentiels — moins d’effort d’audit.`, tone: 'ok' },
      ],
      kpis: [],
      hasData: true,
    },
    {
      n: 6,
      clause: '9.3.2 d',
      title: 'Retours des parties intéressées',
      kind: 'bullets',
      summary: 'Clients, régulateur, salariés, fournisseurs.',
      bullets: [
        { head: 'Preuves —', body: m.evidencesStale > 0 ? `${plural(m.evidencesStale, 'preuve périmée', 'preuves périmées')} à renouveler.` : 'coffre de preuves à jour.', tone: m.evidencesStale > 0 ? 'warn' : 'ok' },
        { head: 'Documentaire —', body: m.documentsReviewOverdue > 0 ? `${plural(m.documentsReviewOverdue, 'document', 'documents')} en revue échue.` : 'revues documentaires à jour.', tone: m.documentsReviewOverdue > 0 ? 'warn' : 'ok' },
      ],
      kpis: [],
      hasData: m.evidencesStale > 0 || m.documentsReviewOverdue > 0,
    },
    {
      n: 7,
      clause: '9.3.2 f',
      title: 'Opportunités d’amélioration',
      kind: 'bullets',
      summary: 'Pistes issues des données ci-dessus — à trancher en séance.',
      bullets: [
        { head: 'Automatiser', body: 'la collecte de preuves périodiques pour réduire la péremption.', tone: 'muted' },
        { head: 'Étendre', body: 'la mutualisation des contrôles aux référentiels non couverts.', tone: 'muted' },
      ],
      kpis: [],
      hasData: false,
    },
  ];
}

/** Nombre de sections de l'ordre du jour alimentées par des données réelles. */
export function reviewInputsReady(sections: AgendaSection[]): number {
  return sections.filter((s) => s.hasData).length;
}

/** Date suggérée de la prochaine revue : douze mois après la séance (clause 9.3, rythme au moins annuel). */
export function suggestNextReview(heldAtIso: string): string {
  const [y, mo, d] = heldAtIso.slice(0, 10).split('-').map(Number);
  const next = new Date(Date.UTC((y ?? 0) + 1, (mo ?? 1) - 1, d ?? 1));
  return next.toISOString().slice(0, 10);
}

/** Une décision n'est convertible en action que si elle ne l'est pas déjà. */
export function decisionConvertible(decision: { actionId: string | null }): boolean {
  return decision.actionId === null;
}
