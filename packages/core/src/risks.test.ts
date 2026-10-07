import { describe, expect, it } from 'vitest';

import {
  acceptanceNeedsAttention,
  acceptanceState,
  bandRank,
  defaultRiskScale,
  riskBand,
  riskScore,
  treatmentActionPriority,
  treatmentPlanNeedsAttention,
  treatmentPlanState,
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

describe('treatmentPlanState (traduction du traitement en actions)', () => {
  const base = { treatment: 'reduire' as const, netBand: 'eleve' as const, residualTarget: 'moyen' as const, openActions: 0, overdueActions: 0, doneActions: 0 };

  it('réduire sans action ouverte et au-dessus de la cible ⇒ non planifié', () => {
    expect(treatmentPlanState(base)).toBe('non_planifie');
    expect(treatmentPlanNeedsAttention('non_planifie')).toBe(true);
  });

  it('sans cible définie et sans action ⇒ non planifié', () => {
    expect(treatmentPlanState({ ...base, residualTarget: null })).toBe('non_planifie');
  });

  it('risque net au niveau de la cible sans action ouverte ⇒ cible atteinte', () => {
    expect(treatmentPlanState({ ...base, netBand: 'moyen' })).toBe('cible_atteinte');
    expect(treatmentPlanState({ ...base, netBand: 'faible' })).toBe('cible_atteinte');
    expect(treatmentPlanNeedsAttention('cible_atteinte')).toBe(false);
  });

  it('actions ouvertes ⇒ en cours, ou en retard dès qu’une échéance est dépassée', () => {
    expect(treatmentPlanState({ ...base, openActions: 2 })).toBe('en_cours');
    expect(treatmentPlanState({ ...base, openActions: 2, overdueActions: 1 })).toBe('en_retard');
    expect(treatmentPlanNeedsAttention('en_retard')).toBe(true);
  });

  it('actions toutes terminées sans atteindre la cible ⇒ à recoter', () => {
    expect(treatmentPlanState({ ...base, doneActions: 2 })).toBe('a_recoter');
    expect(treatmentPlanNeedsAttention('a_recoter')).toBe(true);
    expect(treatmentPlanState({ ...base, netBand: 'moyen', doneActions: 2 })).toBe('cible_atteinte');
  });

  it('accepter relève de l’acceptation signée, pas du plan d’action', () => {
    expect(treatmentPlanState({ ...base, treatment: 'accepter' })).toBe('sans_objet');
  });

  it('transférer et éviter se planifient comme réduire', () => {
    expect(treatmentPlanState({ ...base, treatment: 'transferer' })).toBe('non_planifie');
    expect(treatmentPlanState({ ...base, treatment: 'eviter', openActions: 1 })).toBe('en_cours');
  });
});
describe('treatmentActionPriority', () => {
  it('propose P1 pour un risque net critique ou élevé, P3 pour un risque faible', () => {
    expect(treatmentActionPriority('critique')).toBe('p1');
    expect(treatmentActionPriority('eleve')).toBe('p1');
    expect(treatmentActionPriority('moyen')).toBe('p2');
    expect(treatmentActionPriority('faible')).toBe('p3');
    expect(treatmentActionPriority(null)).toBe('p2');
  });
});