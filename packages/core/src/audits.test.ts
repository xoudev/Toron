import { describe, expect, it } from 'vitest';

import { auditorSeparationOk, findingRequiresAction } from './audits.ts';

describe('séparation des tâches (RM §5.8 / S5)', () => {
  it('refuse un auditeur qui figure parmi les audités', () => {
    expect(auditorSeparationOk('u1', ['u2', 'u3'])).toBe(true);
    expect(auditorSeparationOk('u1', ['u1', 'u2'])).toBe(false);
    expect(auditorSeparationOk('u1', [])).toBe(true);
  });
});

describe('constats', () => {
  it('seules les non-conformités exigent une action corrective', () => {
    expect(findingRequiresAction('nc_mineure')).toBe(true);
    expect(findingRequiresAction('nc_majeure')).toBe(true);
    expect(findingRequiresAction('conforme')).toBe(false);
    expect(findingRequiresAction('observation')).toBe(false);
  });
});
