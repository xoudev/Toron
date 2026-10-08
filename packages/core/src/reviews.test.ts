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
  risksUnplanned: 0,
  risksToReassess: 0,
  risksPlanLate: 0,
  controlsMutualized: 38,
  controlsActive: 40,
  controlsLate: 0,
  controlsIneffective: 0,
  evidencesStale: 0,
  documentsReviewOverdue: 0,
  training: null,
  continuity: null,
};

describe('continuité à l’ordre du jour', () => {
  const section4 = (m: ReviewInputs) => buildReviewAgenda(m).find((sec) => sec.n === 4)!;

  it('rend compte des exercices parmi les résultats de surveillance et d’audit', () => {
    expect(section4({ ...BASE, continuity: { activities: 4, tested: 3, objectiveMissed: 1, exercisesHeld: 3 } }).bullets).toContainEqual({
      head: 'Continuité —', body: '3 exercices réalisés sur douze mois ; activités critiques testées : 3 sur 4, dont 1 objectif de reprise manqué.', tone: 'danger',
    });
    expect(section4({ ...BASE, continuity: { activities: 2, tested: 2, objectiveMissed: 0, exercisesHeld: 2 } }).bullets.find((b) => b.head === 'Continuité —')?.tone).toBe('ok');
  });

  it('module masqué : pas de ligne', () => {
    expect(section4(BASE).bullets.some((b) => b.head.startsWith('Continuité'))).toBe(false);
  });
});

describe('sensibilisation à l’ordre du jour', () => {
  const section6 = (m: ReviewInputs) => buildReviewAgenda(m).find((sec) => sec.n === 6)!;

  it('rend compte des sessions et de la formation des dirigeants parmi les retours des parties intéressées', () => {
    const sec = section6({ ...BASE, training: { held: 3, participations: 162, leaders: 1, leadersUpToDate: 1 } });
    expect(sec.hasData).toBe(true);
    expect(sec.bullets.at(-1)).toEqual({
      head: 'Sensibilisation —', body: '3 sessions tenues sur douze mois, 162 participations ; dirigeants formés à jour : 1 sur 1.', tone: 'ok',
    });
  });

  it('signale un dirigeant sans formation à jour, ou l’absence de session', () => {
    expect(section6({ ...BASE, training: { held: 2, participations: 40, leaders: 2, leadersUpToDate: 1 } }).bullets.at(-1)?.tone).toBe('danger');
    expect(section6({ ...BASE, training: { held: 0, participations: 0, leaders: 0, leadersUpToDate: 0 } }).bullets.at(-1)).toEqual({
      head: 'Sensibilisation —', body: 'aucune session tenue sur douze mois.', tone: 'warn',
    });
  });

  it('module masqué : pas de ligne', () => {
    expect(section6(BASE).bullets.some((b) => b.head.startsWith('Sensibilisation'))).toBe(false);
  });
});

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

  it('rend compte du plan de traitement des risques', () => {
    const line = (m: ReviewInputs) => buildReviewAgenda(m).find((s) => s.n === 5)!.bullets.find((b) => b.head === 'Plan de traitement —')!;
    expect(line(BASE)).toEqual({ head: 'Plan de traitement —', body: 'chaque décision de traitement a ses actions, dans les temps.', tone: 'ok' });
    expect(line({ ...BASE, risksUnplanned: 2, risksPlanLate: 1, risksToReassess: 1 })).toEqual({
      head: 'Plan de traitement —',
      body: '2 risques sans action engagée, 1 risque dont une action est en retard, 1 risque à recoter (actions soldées).',
      tone: 'warn',
    });
    expect(line({ ...BASE, risksToReassess: 3 }).tone).toBe('muted');
  });

  it('rend compte des revues d’efficacité des contrôles', () => {
    const line = (m: ReviewInputs) => buildReviewAgenda(m).find((s) => s.n === 4)!.bullets.find((b) => b.head === 'Revues de contrôle —')!;
    expect(line(BASE)).toEqual({ head: 'Revues de contrôle —', body: '40 contrôles revus dans les temps et jugés efficaces.', tone: 'ok' });
    expect(line({ ...BASE, controlsLate: 3, controlsIneffective: 1 })).toEqual({
      head: 'Revues de contrôle —', body: 'sur 40 contrôles actifs : 3 en retard de revue, 1 jugé inefficace.', tone: 'danger',
    });
    expect(line({ ...BASE, controlsLate: 1 }).tone).toBe('warn');
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
