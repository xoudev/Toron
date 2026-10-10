import { describe, expect, it } from 'vitest';

import {
  countStatuses,
  exclusionAllowed,
  isSoaItemValid,
  normalizeSoaItem,
  recyfEntityKindDefault,
  recyfPreExclusions,
  scoreAssessment,
  soaExportReady,
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

describe('soaExportReady', () => {
  it('campagne ReCyF entité importante fraîchement créée : export bloqué malgré les 76 pré-exclusions', () => {
    const fresh = [
      ...items(...Array<AssessmentItemStatus>(76).fill('non_applicable')),
      ...items(...Array<AssessmentItemStatus>(76).fill('a_evaluer')),
    ];
    expect(soaExportReady(scoreAssessment(fresh))).toBe(false);
  });

  it('exportable dès qu’une exigence applicable est évaluée, conforme ou en écart', () => {
    expect(soaExportReady(scoreAssessment(items('non_applicable', 'a_evaluer', 'conforme')))).toBe(true);
    expect(soaExportReady(scoreAssessment(items('a_evaluer', 'ecart')))).toBe(true);
  });

  it('bloqué sur une campagne vide ou sans évaluation', () => {
    expect(soaExportReady(scoreAssessment([]))).toBe(false);
    expect(soaExportReady(scoreAssessment(items('a_evaluer', 'a_evaluer')))).toBe(false);
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

describe('normalizeSoaItem', () => {
  it('une exclusion sort de la SoA avec sa justification', () => {
    expect(normalizeSoaItem('non_applicable', '  Aucun développement interne.  ')).toEqual({
      soaIncluded: false,
      soaJustification: 'Aucun développement interne.',
    });
  });

  it('les autres statuts restent inclus, sans justification d’exclusion périmée', () => {
    expect(normalizeSoaItem('conforme', 'Ancienne justification N/A')).toEqual({ soaIncluded: true, soaJustification: null });
    expect(normalizeSoaItem('ecart', null)).toEqual({ soaIncluded: true, soaJustification: null });
    expect(normalizeSoaItem('a_evaluer', undefined)).toEqual({ soaIncluded: true, soaJustification: null });
  });

  it('une justification vide devient null', () => {
    expect(normalizeSoaItem('non_applicable', '   ').soaJustification).toBeNull();
  });
});

describe('exclusionAllowed', () => {
  it('ISO 27001 : seules les mesures de l’Annexe A s’excluent', () => {
    expect(exclusionAllowed('iso27001', 'A.5.1')).toBe(true);
    expect(exclusionAllowed('iso27001', 'A.8.34')).toBe(true);
    expect(exclusionAllowed('iso27001', '6.1.2')).toBe(false);
    expect(exclusionAllowed('iso27001', '4.1')).toBe(false);
    expect(exclusionAllowed('iso27001', '10.2')).toBe(false);
  });

  it('les autres référentiels admettent l’exclusion justifiée', () => {
    expect(exclusionAllowed('recyf', '16.1-EE')).toBe(true);
    expect(exclusionAllowed('iso9001', '8.3')).toBe(true);
    expect(exclusionAllowed('exigences_groupe', 'G-01')).toBe(true);
  });
});

describe('ReCyF : catégorie d’entité et pré-exclusions', () => {
  const means = [
    { ref: '1.1-EI/EE', ei: true, ee: true },
    { ref: '16.1-EE', ei: false, ee: true },
    { ref: '16.2-EE', ei: false, ee: true },
  ];

  it('entité importante : les moyens réservés aux entités essentielles sont pré-exclus', () => {
    const r = recyfPreExclusions(means, 'ei', 'v2.5');
    expect(r.refs).toEqual(['16.1-EE', '16.2-EE']);
    expect(r.justification).toBe(
      'Mesure exigée des seules entités essentielles (ReCyF v2.5) — organisation qualifiée entité importante.',
    );
  });

  it('entité essentielle : rien n’est exclu', () => {
    expect(recyfPreExclusions(means, 'ee', '2.5').refs).toEqual([]);
  });

  it('catégorie proposée d’après la qualification NIS 2 des entités', () => {
    expect(recyfEntityKindDefault(['ei', 'ee'])).toBe('ee');
    expect(recyfEntityKindDefault(['non_concernee', 'ei'])).toBe('ei');
    expect(recyfEntityKindDefault(['indeterminee'])).toBeNull();
    expect(recyfEntityKindDefault([])).toBeNull();
  });
});

describe('suggestInheritedStatuses (héritage mutualisé, RM §5.3)', () => {
  const peer = (overrides: Partial<MutualizedPeer> = {}): MutualizedPeer => ({
    requirementId: 'r-nis',
    requirementRef: 'OBJ-08',
    frameworkId: 'fw-recyf',
    frameworkCode: 'recyf',
    frameworkName: 'NIS 2 · ReCyF',
    viaControlTitle: 'MFA sur les accès distants',
    currentStatus: 'a_evaluer',
    campaignOpen: true,
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
    expect(s[0]?.frameworkId).toBe('fw-recyf');
    expect(s[0]?.hasCampaign).toBe(true);
  });

  it('signale un pair qu’aucune campagne ne porte encore', () => {
    const s = suggestInheritedStatuses({ status: 'conforme', requirementRef: 'A.8.5' }, [
      peer({ currentStatus: null, campaignOpen: false }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]?.hasCampaign).toBe(false);
  });

  it('pair dont la campagne est clôturée : rien à hériter tant qu’aucune campagne n’est en cours', () => {
    const s = suggestInheritedStatuses({ status: 'conforme', requirementRef: 'A.8.5' }, [
      peer({ currentStatus: 'a_evaluer', campaignOpen: false }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]?.hasCampaign).toBe(false);
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
