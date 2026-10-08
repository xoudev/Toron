import { describe, expect, it } from 'vitest';

import {
  canManageSatisfaction,
  complaintsTrend,
  csatRate,
  monthlyComplaints,
  npsScore,
  surveyError,
  surveyScore,
  surveyTrend,
  surveyVerdict,
} from './satisfaction.ts';

const TODAY = '2026-10-08';

describe('scores', () => {
  it('le NPS retranche les détracteurs des promoteurs, en points', () => {
    expect(npsScore(52, 31, 17)).toBe(35);
    expect(npsScore(10, 0, 30)).toBe(-50);
    expect(npsScore(0, 0, 0)).toBe(0);
  });

  it('le CSAT est la part de satisfaits', () => {
    expect(csatRate(178, 212)).toBe(84);
    expect(surveyScore({ method: 'csat', respondents: 212, satisfied: 178, promoters: null, passives: null, detractors: null })).toBe(84);
    expect(surveyScore({ method: 'nps', respondents: 100, satisfied: null, promoters: 52, passives: 31, detractors: 17 })).toBe(35);
  });

  it('objectif et tendance', () => {
    expect(surveyVerdict(35, 40)).toBe('sous_objectif');
    expect(surveyVerdict(40, 40)).toBe('atteint');
    expect(surveyVerdict(35, null)).toBe('sans_objectif');
    expect(surveyTrend(35, 28)).toBe('hausse');
    expect(surveyTrend(35, 37)).toBe('stable');
    expect(surveyTrend(30, 35)).toBe('baisse');
    expect(surveyTrend(35, null)).toBeNull();
  });
});

describe('saisie', () => {
  const nps = { method: 'nps' as const, respondents: 100, promoters: 52, passives: 31, detractors: 17, satisfied: null, closedOn: '2026-09-30', invitedCount: 400, target: 40 };

  it('une enquête NPS valide passe ; ses répartitions doivent totaliser les répondants', () => {
    expect(surveyError(nps, TODAY)).toBeNull();
    expect(surveyError({ ...nps, detractors: 20 }, TODAY)).toMatch(/totaliser/);
    expect(surveyError({ ...nps, passives: null }, TODAY)).toMatch(/passifs/);
    expect(surveyError({ ...nps, target: 120 }, TODAY)).toMatch(/-100 et 100/);
  });

  it('pas d’enquête future, pas plus de répondants que de sollicités', () => {
    expect(surveyError({ ...nps, closedOn: '2026-11-01' }, TODAY)).toMatch(/future/);
    expect(surveyError({ ...nps, invitedCount: 80 }, TODAY)).toMatch(/dépasser/);
    expect(surveyError({ ...nps, respondents: 0, promoters: 0, passives: 0, detractors: 0 }, TODAY)).toMatch(/1 au moins/);
  });

  it('une enquête CSAT exige les satisfaits, dans la limite des répondants, et un objectif en pourcentage', () => {
    const csat = { ...nps, method: 'csat' as const, promoters: null, passives: null, detractors: null, satisfied: 80, target: 85 };
    expect(surveyError(csat, TODAY)).toBeNull();
    expect(surveyError({ ...csat, satisfied: null }, TODAY)).toMatch(/satisfaits/);
    expect(surveyError({ ...csat, satisfied: 120 }, TODAY)).toMatch(/dépasser les répondants/);
    expect(surveyError({ ...csat, target: -5 }, TODAY)).toMatch(/pourcentage/);
  });
});

describe('réclamations', () => {
  const opened = ['2026-10-02', '2026-09-15', '2026-09-03', '2026-03-20', '2025-11-12', '2025-10-08', '2025-06-01', '2024-12-01'];

  it('compte par mois sur douze mois glissants, du plus ancien au plus récent', () => {
    const months = monthlyComplaints(opened, TODAY);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: '2025-11', count: 1 });
    expect(months.at(-1)).toEqual({ month: '2026-10', count: 1 });
    expect(months.find((m) => m.month === '2026-09')?.count).toBe(2);
    expect(months.reduce((n, m) => n + m.count, 0)).toBe(5);
  });

  it('compare les douze derniers mois aux douze précédents', () => {
    expect(complaintsTrend(opened, TODAY)).toEqual({ current: 5, previous: 3 });
  });

  it('les gestionnaires consignent, l’auditeur et le lecteur consultent', () => {
    expect(canManageSatisfaction('resp_qualite')).toBe(true);
    expect(canManageSatisfaction('auditeur')).toBe(false);
  });
});
