import { describe, expect, it } from 'vitest';

import { canEditVersion, nextSemver, reviewOverdue } from './documents.ts';

describe('immuabilité d’une version publiée (RM §5.6)', () => {
  it('seul un brouillon est modifiable', () => {
    expect(canEditVersion('brouillon')).toBe(true);
    expect(canEditVersion('publie')).toBe(false);
  });
});

describe('nextSemver', () => {
  it('incrémente la mineure, 1.0 si aucune version', () => {
    expect(nextSemver(null)).toBe('1.0');
    expect(nextSemver('2.4')).toBe('2.5');
    expect(nextSemver('v1.0')).toBe('1.1');
    expect(nextSemver('3')).toBe('3.1');
    expect(nextSemver('bidon')).toBe('1.0');
  });
});

describe('alerte de revue', () => {
  const today = new Date('2026-07-18T10:00:00Z');
  it('dépassée si strictement antérieure à aujourd’hui', () => {
    expect(reviewOverdue(new Date('2026-06-30'), today)).toBe(true);
    expect(reviewOverdue(new Date('2026-07-18'), today)).toBe(false);
    expect(reviewOverdue(new Date('2026-08-01'), today)).toBe(false);
    expect(reviewOverdue(null, today)).toBe(false);
  });
});
