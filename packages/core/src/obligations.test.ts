import { describe, expect, it } from 'vitest';

import {
  OBLIGATION_CATALOG,
  companySize,
  nis2Qualification,
  obligationAttention,
  obligationJustificationRequired,
  suggestedObligations,
} from './obligations.ts';

const size = (employees: number | null, turnoverMeur: number | null = null, balanceSheetMeur: number | null = null) => ({ employees, turnoverMeur, balanceSheetMeur });

describe('catégorie d’entreprise', () => {
  it('applique les seuils d’effectif', () => {
    expect(companySize(size(12))).toBe('petite');
    expect(companySize(size(50))).toBe('moyenne');
    expect(companySize(size(249))).toBe('moyenne');
    expect(companySize(size(250))).toBe('grande');
  });

  it('retient le chiffre d’affaires et le bilan seulement quand les deux dépassent le seuil', () => {
    expect(companySize(size(30, 12, 11))).toBe('moyenne');
    expect(companySize(size(30, 12, 4))).toBe('petite');
    expect(companySize(size(120, 60, 50))).toBe('grande');
    expect(companySize(size(120, 60, 20))).toBe('moyenne');
  });

  it('reste indéterminée sans effectif', () => {
    expect(companySize(size(null, 80, 80))).toBeNull();
  });
});

describe('qualification NIS 2', () => {
  it('grande entreprise d’un secteur de l’annexe I : entité essentielle', () => {
    expect(nis2Qualification({ sector: 'energie', ...size(400), override: null })).toMatchObject({ status: 'ee', overridden: false });
  });

  it('entreprise moyenne de l’annexe I, ou moyenne et grande de l’annexe II : entité importante', () => {
    expect(nis2Qualification({ sector: 'sante', ...size(80), override: null }).status).toBe('ei');
    expect(nis2Qualification({ sector: 'postal_expedition', ...size(148, 31.5, 18.2), override: null })).toMatchObject({
      status: 'ei',
      reason: 'Services postaux et d’expédition (annexe II), entreprise moyenne.',
    });
    expect(nis2Qualification({ sector: 'alimentaire', ...size(900), override: null }).status).toBe('ei');
  });

  it('petite entreprise ou secteur hors annexes : non concernée', () => {
    expect(nis2Qualification({ sector: 'energie', ...size(20), override: null }).status).toBe('non_concernee');
    expect(nis2Qualification({ sector: 'hors_champ', ...size(2000), override: null }).status).toBe('non_concernee');
  });

  it('demande le secteur et l’effectif avant de conclure', () => {
    expect(nis2Qualification({ sector: null, ...size(200), override: null }).status).toBe('indeterminee');
    expect(nis2Qualification({ sector: 'energie', ...size(null), override: null }).status).toBe('indeterminee');
  });

  it('une désignation prime sur les critères et reste tracée', () => {
    const q = nis2Qualification({ sector: 'services_tic', ...size(20), override: 'ee' });
    expect(q).toMatchObject({ status: 'ee', computed: 'non_concernee', overridden: true });
    expect(q.reason).toContain('retenue par l’organisation');
    // Une « désignation » identique au calcul n'est pas une dérogation.
    expect(nis2Qualification({ sector: 'energie', ...size(400), override: 'ee' }).overridden).toBe(false);
  });
});

describe('registre des obligations', () => {
  it('propose les obligations NIS 2 aux seules entités concernées, le RGPD à toutes', () => {
    const nis2Count = OBLIGATION_CATALOG.filter((o) => o.regime === 'nis2').length;
    const rgpdCount = OBLIGATION_CATALOG.filter((o) => o.regime === 'rgpd').length;
    expect(suggestedObligations('ei')).toHaveLength(nis2Count + rgpdCount);
    expect(suggestedObligations('non_concernee').every((o) => o.regime === 'rgpd')).toBe(true);
    expect(suggestedObligations('indeterminee')).toHaveLength(rgpdCount);
  });

  it('les clés du catalogue sont uniques', () => {
    const keys = OBLIGATION_CATALOG.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('exige une justification pour écarter une obligation', () => {
    expect(obligationJustificationRequired('non_applicable')).toBe(true);
    expect(obligationJustificationRequired('a_evaluer')).toBe(false);
  });

  it('signale les échéances dépassées ou à moins de 30 jours des obligations ouvertes', () => {
    expect(obligationAttention('en_cours', '2026-10-01', '2026-10-06')).toBe('en_retard');
    expect(obligationAttention('a_evaluer', '2026-11-05', '2026-10-06')).toBe('proche');
    expect(obligationAttention('a_evaluer', '2026-11-06', '2026-10-06')).toBe('aucune');
    expect(obligationAttention('conforme', '2026-10-01', '2026-10-06')).toBe('aucune');
    expect(obligationAttention('en_cours', null, '2026-10-06')).toBe('aucune');
  });
});
