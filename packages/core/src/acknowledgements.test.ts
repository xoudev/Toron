import { describe, expect, it } from 'vitest';

import { acknowledgementExpected, acknowledgementProgress } from './acknowledgements.ts';

describe('accusés de lecture', () => {
  it('calcule l’avancement sans dépasser l’effectif', () => {
    expect(acknowledgementProgress(3, 5)).toEqual({ acknowledged: 3, total: 5, pct: 60, complete: false });
    expect(acknowledgementProgress(5, 5).complete).toBe(true);
    expect(acknowledgementProgress(7, 5)).toMatchObject({ acknowledged: 5, pct: 100, complete: true });
    expect(acknowledgementProgress(0, 0)).toEqual({ acknowledged: 0, total: 0, pct: null, complete: false });
  });
  it('n’attend une lecture que d’une version publiée d’un document obligatoire', () => {
    expect(acknowledgementExpected({ required: true, publishedVersionId: 'v1', acknowledgedByMe: false })).toBe(true);
    expect(acknowledgementExpected({ required: true, publishedVersionId: 'v1', acknowledgedByMe: true })).toBe(false);
    expect(acknowledgementExpected({ required: true, publishedVersionId: null, acknowledgedByMe: false })).toBe(false);
    expect(acknowledgementExpected({ required: false, publishedVersionId: 'v1', acknowledgedByMe: false })).toBe(false);
  });
});
