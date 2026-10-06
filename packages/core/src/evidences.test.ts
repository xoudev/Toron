import { describe, expect, it } from 'vitest';

import { freshnessNeedsAttention, freshnessRank, freshnessState, suggestedValidUntil } from './evidences.ts';

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
