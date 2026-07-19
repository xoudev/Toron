import { describe, expect, it } from 'vitest';

import { deriveScenarioLikelihood, likelihoodValue, scenarioRiskRating, scenarioStatus, EBIOS_WORKSHOPS } from './ebios.ts';

describe('ateliers EBIOS RM', () => {
  it('expose les cinq ateliers dans l’ordre', () => {
    expect(EBIOS_WORKSHOPS).toHaveLength(5);
    expect(EBIOS_WORKSHOPS.map((w) => w.num)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('vraisemblance dérivée de la kill chain', () => {
  it('null quand aucune phase n’est renseignée', () => {
    expect(deriveScenarioLikelihood([])).toBeNull();
  });

  it('s’affine avec la complétude des phases', () => {
    expect(deriveScenarioLikelihood(['connaitre'])).toBe('v1');
    expect(deriveScenarioLikelihood(['connaitre', 'rentrer'])).toBe('v1');
    expect(deriveScenarioLikelihood(['connaitre', 'rentrer', 'trouver'])).toBe('v2');
    expect(deriveScenarioLikelihood(['connaitre', 'rentrer', 'trouver', 'exploiter'])).toBe('v3');
  });

  it('ignore les doublons de phase', () => {
    expect(deriveScenarioLikelihood(['connaitre', 'connaitre', 'rentrer'])).toBe('v1');
  });
});

describe('statut et cotation du scénario', () => {
  it('à faire, en cours, coté', () => {
    expect(scenarioStatus({ likelihood: null, actionCount: 0 })).toBe('a_faire');
    expect(scenarioStatus({ likelihood: null, actionCount: 2 })).toBe('en_cours');
    expect(scenarioStatus({ likelihood: 'v2', actionCount: 5 })).toBe('cote');
  });

  it('la vraisemblance alimente la valeur du risque généré', () => {
    expect(likelihoodValue('v3')).toBe(3);
    expect(scenarioRiskRating('v3')).toEqual({ g: 3, v: 3 });
    expect(scenarioRiskRating('v1', 4)).toEqual({ g: 4, v: 1 });
  });
});
