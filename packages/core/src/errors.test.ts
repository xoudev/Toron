import { describe, expect, it } from 'vitest';

import { appError } from './errors.js';

describe('appError', () => {
  it('produit le format standard { code, message, correlationId }', () => {
    const err = appError(
      'IMPORT_DATE_INVALIDE',
      'La date « 31/02/2026 » est invalide — corrigez la date à la ligne 47.',
    );
    expect(err.code).toBe('IMPORT_DATE_INVALIDE');
    expect(err.message).toContain('corrigez');
    expect(err.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('génère un correlationId unique par erreur', () => {
    const a = appError('X', 'x');
    const b = appError('X', 'x');
    expect(a.correlationId).not.toBe(b.correlationId);
  });

  it('accepte un correlationId fourni (propagation entre couches)', () => {
    const err = appError('X', 'x', 'cid-fourni');
    expect(err.correlationId).toBe('cid-fourni');
  });
});
