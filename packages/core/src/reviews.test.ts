import { describe, expect, it } from 'vitest';

import { buildReviewAgenda, decisionConvertible, reviewInputsReady, suggestNextReview, type ReviewInputs } from './reviews.ts';

const BASE: ReviewInputs = {
  actionsOpen: 2,
  actionsOverdue: 0,
  coveragePct: 72,
  gaps: 23,
  incidentsOpen: 1,
  auditsInProgress: 1,
  auditsClosed: 1,
  ncOpen: 3,
  ncInEffectivenessCheck: 2,
  risksHigh: 14,
  risksTotal: 30,
  controlsMutualized: 38,
  evidencesStale: 0,
  documentsReviewOverdue: 0,
};

describe('ordre du jour de la revue de direction (clause 9.3.2)', () => {
  it('produit les sept entrées obligatoires dans l’ordre', () => {
    const agenda = buildReviewAgenda(BASE);
    expect(agenda).toHaveLength(7);
    expect(agenda.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(agenda[0]!.clause).toBe('9.3.2 a');
    expect(agenda.map((s) => s.kind)).toEqual(['actions', 'bullets', 'kpi', 'bullets', 'bullets', 'bullets', 'bullets']);
  });

  it('injecte les métriques réelles dans les KPI et les risques', () => {
    const agenda = buildReviewAgenda(BASE);
    const kpi = agenda.find((s) => s.kind === 'kpi')!;
    expect(kpi.kpis.find((k) => k.label === 'COUVERTURE')!.value).toBe('72 %');
    expect(kpi.kpis.find((k) => k.label === 'CONTRÔLES MUTUALISÉS')!.value).toBe('38');
    const risks = agenda.find((s) => s.n === 5)!;
    expect(risks.summary).toContain('14');
    expect(risks.summary).toContain('30');
  });

  it('gère une couverture nulle sans casser', () => {
    const agenda = buildReviewAgenda({ ...BASE, coveragePct: null });
    const kpi = agenda.find((s) => s.kind === 'kpi')!;
    expect(kpi.kpis.find((k) => k.label === 'COUVERTURE')!.value).toBe('—');
  });

  it('reviewInputsReady compte les sections alimentées par des données', () => {
    const agenda = buildReviewAgenda(BASE);
    // Sections 1,3,4,5 toujours alimentées ; 6 dépend des données (ici 0 → non).
    expect(reviewInputsReady(agenda)).toBe(4);
    const withFeedback = buildReviewAgenda({ ...BASE, evidencesStale: 2 });
    expect(reviewInputsReady(withFeedback)).toBe(5);
  });
});

describe('règles de séance', () => {
  it('suggère la prochaine revue douze mois plus tard', () => {
    expect(suggestNextReview('2026-01-15')).toBe('2027-01-15');
    expect(suggestNextReview('2026-07-24')).toBe('2027-07-24');
  });

  it('une décision n’est convertible que si elle ne l’est pas déjà', () => {
    expect(decisionConvertible({ actionId: null })).toBe(true);
    expect(decisionConvertible({ actionId: 'a1' })).toBe(false);
  });
});
