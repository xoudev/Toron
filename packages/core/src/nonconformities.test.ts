import { describe, expect, it } from 'vitest';

import { effectivenessCheckDate, effectivenessDue, isNcOpen } from './nonconformities.ts';

describe('vérification d’efficacité J+90 (RM §7.2)', () => {
  it('la date de vérification est la clôture + 90 jours', () => {
    const closed = new Date('2026-07-18T00:00:00Z');
    expect(effectivenessCheckDate(closed).toISOString().slice(0, 10)).toBe('2026-10-16');
  });

  it('à vérifier seulement si « clôturée à vérifier » et J+90 atteint', () => {
    const check = new Date('2026-10-16');
    expect(effectivenessDue('cloturee_a_verifier', check, new Date('2026-10-16'))).toBe(true);
    expect(effectivenessDue('cloturee_a_verifier', check, new Date('2026-10-15'))).toBe(false);
    expect(effectivenessDue('efficace', check, new Date('2027-01-01'))).toBe(false);
    expect(effectivenessDue('ouverte', null, new Date('2027-01-01'))).toBe(false);
  });

  it('une NC n’est « fermée » que lorsqu’elle est efficace', () => {
    expect(isNcOpen('ouverte')).toBe(true);
    expect(isNcOpen('cloturee_a_verifier')).toBe(true);
    expect(isNcOpen('rouverte')).toBe(true);
    expect(isNcOpen('efficace')).toBe(false);
  });
});
