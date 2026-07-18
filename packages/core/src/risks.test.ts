import { describe, expect, it } from 'vitest';

import {
  acceptanceNeedsAttention,
  acceptanceState,
  bandRank,
  defaultRiskScale,
  riskBand,
  riskScore,
} from './risks.ts';

const SCALE = defaultRiskScale();

describe('riskBand (matrice G×V)', () => {
  it('classe les coins de la matrice 4×4 par défaut', () => {
    expect(riskBand(1, 1, SCALE)).toBe('faible');
    expect(riskBand(4, 4, SCALE)).toBe('critique');
    expect(riskBand(4, 1, SCALE)).toBe('moyen');
    expect(riskBand(1, 4, SCALE)).toBe('moyen');
    expect(riskBand(3, 3, SCALE)).toBe('eleve');
  });

  it('renvoie null hors matrice (garde-fou : échelle réduite)', () => {
    expect(riskBand(0, 2, SCALE)).toBeNull();
    expect(riskBand(5, 2, SCALE)).toBeNull();
    expect(riskBand(2, 9, SCALE)).toBeNull();
    expect(riskBand(2.5, 2, SCALE)).toBeNull();
  });

  it('la matrice est monotone : augmenter G ou V ne baisse jamais la bande', () => {
    for (let g = 1; g <= 4; g += 1) {
      for (let v = 1; v < 4; v += 1) {
        expect(bandRank(riskBand(g, v + 1, SCALE)!)).toBeGreaterThanOrEqual(
          bandRank(riskBand(g, v, SCALE)!),
        );
      }
    }
    for (let v = 1; v <= 4; v += 1) {
      for (let g = 1; g < 4; g += 1) {
        expect(bandRank(riskBand(g + 1, v, SCALE)!)).toBeGreaterThanOrEqual(
          bandRank(riskBand(g, v, SCALE)!),
        );
      }
    }
  });

  it('riskScore = produit G×V', () => {
    expect(riskScore(3, 4)).toBe(12);
    expect(riskScore(1, 1)).toBe(1);
  });
});

describe('acceptanceState (RM §5.4)', () => {
  const now = new Date('2026-07-18T00:00:00Z');

  it('traitement ≠ accepter ⇒ non requise', () => {
    for (const treatment of ['reduire', 'transferer', 'eviter'] as const) {
      expect(acceptanceState({ treatment, acceptance: null }, now)).toBe('non_requise');
    }
  });

  it('accepter sans signature ⇒ en attente (remontée en revue de direction)', () => {
    expect(acceptanceState({ treatment: 'accepter', acceptance: null }, now)).toBe('en_attente');
    expect(acceptanceNeedsAttention('en_attente')).toBe(true);
  });

  it('accepter avec acceptation valide (sans échéance ou future) ⇒ acceptée', () => {
    expect(
      acceptanceState(
        { treatment: 'accepter', acceptance: { acceptedAt: now, expiresAt: null } },
        now,
      ),
    ).toBe('acceptee');
    expect(
      acceptanceState(
        {
          treatment: 'accepter',
          acceptance: { acceptedAt: now, expiresAt: new Date('2027-01-01') },
        },
        now,
      ),
    ).toBe('acceptee');
    expect(acceptanceNeedsAttention('acceptee')).toBe(false);
  });

  it('accepter avec échéance dépassée ⇒ expirée (revalidation requise)', () => {
    expect(
      acceptanceState(
        {
          treatment: 'accepter',
          acceptance: { acceptedAt: new Date('2025-01-01'), expiresAt: new Date('2026-01-01') },
        },
        now,
      ),
    ).toBe('expiree');
    expect(acceptanceNeedsAttention('expiree')).toBe(true);
  });
});
