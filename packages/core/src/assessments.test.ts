import { describe, expect, it } from 'vitest';

import {
  countStatuses,
  isSoaItemValid,
  scoreAssessment,
  soaJustificationRequired,
  suggestInheritedStatuses,
  type AssessmentItemStatus,
  type MutualizedPeer,
} from './assessments.ts';

function items(...statuses: AssessmentItemStatus[]) {
  return statuses.map((status) => ({ status }));
}

describe('countStatuses', () => {
  it('décompte chaque statut', () => {
    expect(countStatuses(items('conforme', 'conforme', 'ecart', 'non_applicable', 'a_evaluer'))).toEqual({
      conforme: 2,
      ecart: 1,
      non_applicable: 1,
      a_evaluer: 1,
    });
  });
});

describe('scoreAssessment (RM §5.3)', () => {
  it('exclut les non applicables du dénominateur', () => {
    // 3 conformes, 1 écart, 2 N/A → applicable = 4, score = 3/4 = 75 %
    const s = scoreAssessment(items('conforme', 'conforme', 'conforme', 'ecart', 'non_applicable', 'non_applicable'));
    expect(s.applicable).toBe(4);
    expect(s.scorePct).toBe(75);
    expect(s.gaps).toBe(1);
    expect(s.total).toBe(6);
  });

  it('compte les « à évaluer » comme applicables non conformes', () => {
    const s = scoreAssessment(items('conforme', 'a_evaluer', 'a_evaluer'));
    expect(s.applicable).toBe(3);
    expect(s.scorePct).toBe(33); // 1/3 arrondi
  });

  it('renvoie un score null si toutes les exigences sont non applicables', () => {
    const s = scoreAssessment(items('non_applicable', 'non_applicable'));
    expect(s.applicable).toBe(0);
    expect(s.scorePct).toBeNull();
  });

  it('100 % quand tout est conforme', () => {
    expect(scoreAssessment(items('conforme', 'conforme')).scorePct).toBe(100);
  });

  it('gère l’ensemble vide', () => {
    const s = scoreAssessment([]);
    expect(s.total).toBe(0);
    expect(s.applicable).toBe(0);
    expect(s.scorePct).toBeNull();
    expect(s.gaps).toBe(0);
  });
});

describe('validation SoA', () => {
  it('exige une justification uniquement pour « non applicable »', () => {
    expect(soaJustificationRequired('non_applicable')).toBe(true);
    expect(soaJustificationRequired('conforme')).toBe(false);
    expect(soaJustificationRequired('ecart')).toBe(false);
    expect(soaJustificationRequired('a_evaluer')).toBe(false);
  });

  it('refuse un « non applicable » sans justification (ou vide)', () => {
    expect(isSoaItemValid({ status: 'non_applicable' })).toBe(false);
    expect(isSoaItemValid({ status: 'non_applicable', soaJustification: '   ' })).toBe(false);
    expect(isSoaItemValid({ status: 'non_applicable', soaJustification: 'Aucun accès distant sur ce périmètre.' })).toBe(true);
  });

  it('accepte les autres statuts sans justification', () => {
    expect(isSoaItemValid({ status: 'conforme' })).toBe(true);
    expect(isSoaItemValid({ status: 'ecart', soaJustification: null })).toBe(true);
  });
});

describe('suggestInheritedStatuses (héritage mutualisé, RM §5.3)', () => {
  const peer = (overrides: Partial<MutualizedPeer> = {}): MutualizedPeer => ({
    requirementId: 'r-nis',
    requirementRef: 'OBJ-08',
    frameworkCode: 'recyf',
    frameworkName: 'NIS 2 · ReCyF',
    viaControlTitle: 'MFA sur les accès distants',
    currentStatus: 'a_evaluer',
    ...overrides,
  });

  it('ne suggère rien si la source n’est pas conforme', () => {
    expect(suggestInheritedStatuses({ status: 'ecart', requirementRef: 'A.8.5' }, [peer()])).toEqual([]);
    expect(suggestInheritedStatuses({ status: 'a_evaluer', requirementRef: 'A.8.5' }, [peer()])).toEqual([]);
  });

  it('suggère « conforme » sur les pairs à évaluer / en écart, avec traçabilité', () => {
    const s = suggestInheritedStatuses({ status: 'conforme', requirementRef: 'A.8.5' }, [
      peer({ currentStatus: 'a_evaluer' }),
      peer({ requirementId: 'r2', requirementRef: 'OBJ-09', currentStatus: 'ecart' }),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0]?.suggestedStatus).toBe('conforme');
    expect(s[0]?.reason).toContain('MFA sur les accès distants');
    expect(s[0]?.reason).toContain('A.8.5');
  });

  it('n’écrase jamais une exclusion (N/A) ni un pair déjà conforme', () => {
    const s = suggestInheritedStatuses({ status: 'conforme', requirementRef: 'A.8.5' }, [
      peer({ currentStatus: 'non_applicable' }),
      peer({ requirementId: 'r2', currentStatus: 'conforme' }),
    ]);
    expect(s).toEqual([]);
  });

  it('gère l’absence de pairs', () => {
    expect(suggestInheritedStatuses({ status: 'conforme', requirementRef: 'A.8.5' }, [])).toEqual([]);
  });
});
