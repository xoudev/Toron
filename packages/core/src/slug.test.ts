import { describe, expect, it } from 'vitest';

import { slugifyTenantName } from './slug.js';

describe('slugifyTenantName', () => {
  it('normalise accents, casse et séparateurs', () => {
    expect(slugifyTenantName('Meridiane Logistics')).toBe('meridiane-logistics');
    expect(slugifyTenantName('Société Générale de Sûreté')).toBe('societe-generale-de-surete');
    expect(slugifyTenantName('  ACME — Groupe (Paris)  ')).toBe('acme-groupe-paris');
  });

  it('borne la longueur à 48 caractères', () => {
    expect(slugifyTenantName('a'.repeat(100))).toHaveLength(48);
  });

  it('retourne une chaîne vide pour une entrée sans caractère utilisable', () => {
    expect(slugifyTenantName('***')).toBe('');
  });
});
