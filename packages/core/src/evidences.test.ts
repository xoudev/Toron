import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_ACCEPT,
  EVIDENCE_MAX_BYTES,
  effectiveValidUntil,
  evidenceFileError,
  freshnessNeedsAttention,
  freshnessRank,
  freshnessState,
  suggestedValidUntil,
} from './evidences.ts';

const today = new Date('2026-07-18T12:00:00Z');

describe('fraîcheur d’une preuve (RM §5.7)', () => {
  it('classe selon l’échéance de validité', () => {
    expect(freshnessState(null, today)).toBe('permanente');
    expect(freshnessState(new Date('2026-06-30'), today)).toBe('expiree');
    expect(freshnessState(new Date('2026-08-01'), today)).toBe('bientot'); // ≤ 30 j
    expect(freshnessState(new Date('2026-12-31'), today)).toBe('fraiche');
  });

  it('le jour de l’échéance est encore « bientôt », pas expiré', () => {
    expect(freshnessState(new Date('2026-07-18'), today)).toBe('bientot');
  });

  it('tri « expirées d’abord »', () => {
    expect(freshnessRank('expiree')).toBeLessThan(freshnessRank('bientot'));
    expect(freshnessRank('bientot')).toBeLessThan(freshnessRank('fraiche'));
    expect(freshnessRank('fraiche')).toBeLessThan(freshnessRank('permanente'));
  });

  it('expirée et bientôt attirent l’attention', () => {
    expect(freshnessNeedsAttention('expiree')).toBe(true);
    expect(freshnessNeedsAttention('bientot')).toBe(true);
    expect(freshnessNeedsAttention('fraiche')).toBe(false);
    expect(freshnessNeedsAttention('permanente')).toBe(false);
  });
});

describe('renouvellement — validité proposée', () => {
  it('ajoute la période de la récurrence', () => {
    expect(suggestedValidUntil('2026-10-06', 'trimestrielle')).toBe('2027-01-06');
    expect(suggestedValidUntil('2026-10-06', 'semestrielle')).toBe('2027-04-06');
    expect(suggestedValidUntil('2026-10-06', 'annuelle')).toBe('2027-10-06');
    expect(suggestedValidUntil('2026-10-06', 'ponctuelle')).toBeNull();
  });
  it('borne au dernier jour du mois d’arrivée', () => {
    expect(suggestedValidUntil('2027-11-30', 'trimestrielle')).toBe('2028-02-29');
    expect(suggestedValidUntil('2026-08-31', 'semestrielle')).toBe('2027-02-28');
  });
});

describe('dépôt — validité retenue', () => {
  it('garde la date saisie', () => {
    expect(effectiveValidUntil('2026-10-06', 'annuelle', '2027-03-31')).toBe('2027-03-31');
    expect(effectiveValidUntil('2026-10-06', 'ponctuelle', '2027-03-31')).toBe('2027-03-31');
  });
  it('une preuve récurrente sans échéance prend celle de sa récurrence', () => {
    expect(effectiveValidUntil('2026-10-06', 'annuelle', null)).toBe('2027-10-06');
    expect(effectiveValidUntil('2026-10-06', 'trimestrielle', null)).toBe('2027-01-06');
  });
  it('une preuve ponctuelle sans échéance reste permanente', () => {
    expect(effectiveValidUntil('2026-10-06', 'ponctuelle', null)).toBeNull();
  });
});

describe('dépôt — contrôle du fichier', () => {
  it('admet les formats bureautiques annoncés (Word, Excel, PowerPoint, ODT, ODS)', () => {
    for (const name of ['PSSI.pdf', 'capture.PNG', 'revue.ods', 'charte.odt', 'inventaire.xls', 'note.doc', 'support.pptx']) {
      expect(evidenceFileError({ name, size: 1024 })).toBeNull();
    }
  });
  it('l’attribut accept reprend l’allowlist', () => {
    expect(EVIDENCE_ACCEPT.split(',')).toContain('.ods');
    expect(EVIDENCE_ACCEPT.split(',')).toContain('.pdf');
  });
  it('refuse un fichier vide', () => {
    expect(evidenceFileError({ name: 'vide.pdf', size: 0 })?.code).toBe('FICHIER_VIDE');
  });
  it('refuse au-delà de 10 Mo, la limite comprise', () => {
    expect(evidenceFileError({ name: 'PSSI.pdf', size: EVIDENCE_MAX_BYTES })).toBeNull();
    const err = evidenceFileError({ name: 'PSSI.pdf', size: EVIDENCE_MAX_BYTES + 1 });
    expect(err?.code).toBe('FICHIER_TROP_GROS');
    expect(err?.message).toContain('10 Mo');
  });
  it('refuse un format hors allowlist ou sans extension', () => {
    expect(evidenceFileError({ name: 'outil.exe', size: 10 })?.message).toContain('(.exe)');
    expect(evidenceFileError({ name: 'rapport', size: 10 })?.message).toContain('sans extension');
    // L'.odp n'est pas admis : le refus ne doit pas annoncer « LibreOffice ».
    const odp = evidenceFileError({ name: 'revue.odp', size: 10 });
    expect(odp?.code).toBe('TYPE_REFUSE');
    expect(odp?.message).not.toContain('LibreOffice');
  });
});
