import { describe, expect, it } from 'vitest';

import {
  controlDeleteImpact,
  frameworksCovered,
  isMutualized,
  type CoveredRequirement,
} from './referentiels.ts';

function req(overrides: Partial<CoveredRequirement> = {}): CoveredRequirement {
  return {
    frameworkId: 'fw-recyf',
    frameworkCode: 'recyf',
    frameworkName: 'NIS 2 · ReCyF',
    requirementId: 'r1',
    requirementRef: 'OBJ-08',
    requirementTitle: 'Authentification renforcée',
    otherControlsCount: 0,
    ...overrides,
  };
}

describe('frameworksCovered', () => {
  it('déduplique et trie les codes de référentiels', () => {
    expect(
      frameworksCovered([
        req({ frameworkCode: 'iso27001' }),
        req({ frameworkCode: 'recyf' }),
        req({ frameworkCode: 'iso27001' }),
      ]),
    ).toEqual(['iso27001', 'recyf']);
  });

  it('renvoie une liste vide sans exigence couverte', () => {
    expect(frameworksCovered([])).toEqual([]);
  });
});

describe('isMutualized', () => {
  it('vrai dès deux référentiels distincts (P1)', () => {
    expect(
      isMutualized([
        req({ frameworkId: 'fw-recyf', frameworkCode: 'recyf' }),
        req({ frameworkId: 'fw-iso', frameworkCode: 'iso27001', requirementRef: 'A.8.5' }),
      ]),
    ).toBe(true);
  });

  it('faux si un seul référentiel, même avec plusieurs exigences', () => {
    expect(
      isMutualized([
        req({ requirementRef: 'OBJ-08' }),
        req({ requirementRef: 'OBJ-01', requirementId: 'r2' }),
      ]),
    ).toBe(false);
  });

  it('faux si aucun mapping', () => {
    expect(isMutualized([])).toBe(false);
  });
});

describe('controlDeleteImpact (RM §5.2)', () => {
  it('sans mapping : aucune confirmation requise', () => {
    const impact = controlDeleteImpact([]);
    expect(impact.requiresConfirmation).toBe(false);
    expect(impact.mappedRequirementCount).toBe(0);
    expect(impact.frameworks).toEqual([]);
  });

  it('exige confirmation et liste les exigences groupées par référentiel', () => {
    const impact = controlDeleteImpact([
      req({
        frameworkId: 'fw-iso',
        frameworkCode: 'iso27001',
        frameworkName: 'ISO/IEC 27001:2022',
        requirementRef: 'A.8.5',
        requirementId: 'r-iso',
      }),
      req({ requirementRef: 'OBJ-08', requirementId: 'r-recyf' }),
    ]);
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.mappedRequirementCount).toBe(2);
    // Trié par code de référentiel : iso27001 avant recyf
    expect(impact.frameworks.map((f) => f.frameworkCode)).toEqual(['iso27001', 'recyf']);
  });

  it('signale les exigences qui deviendraient « découvertes » (dernier contrôle)', () => {
    const impact = controlDeleteImpact([
      req({ requirementRef: 'OBJ-08', requirementId: 'seul', otherControlsCount: 0 }),
      req({ requirementRef: 'OBJ-01', requirementId: 'partage', otherControlsCount: 2 }),
    ]);
    expect(impact.uncoveredRequirementCount).toBe(1);
    const recyf = impact.frameworks.find((f) => f.frameworkCode === 'recyf');
    const seul = recyf?.requirements.find((r) => r.requirementId === 'seul');
    const partage = recyf?.requirements.find((r) => r.requirementId === 'partage');
    expect(seul?.becomesUncovered).toBe(true);
    expect(partage?.becomesUncovered).toBe(false);
  });
});
