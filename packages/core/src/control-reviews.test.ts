import { describe, expect, it } from 'vitest';

import {
  canRecordControlReview,
  controlCorrectiveAction,
  controlReviewError,
  controlReviewState,
  nextControlReview,
  reviewNeedsCorrection,
} from './control-reviews.ts';

const TODAY = '2026-10-07';

describe('échéance des revues de contrôle', () => {
  it('la prochaine revue suit la dernière, ou la création si le contrôle n’a jamais été revu', () => {
    expect(nextControlReview({ frequency: 'trimestrielle', lastReviewedOn: '2026-07-15', createdOn: '2025-01-10' })).toBe('2026-10-15');
    expect(nextControlReview({ frequency: 'annuelle', lastReviewedOn: null, createdOn: '2026-02-28' })).toBe('2027-02-28');
    expect(nextControlReview({ frequency: 'mensuelle', lastReviewedOn: '2026-01-31', createdOn: '2025-01-01' })).toBe('2026-02-28');
    expect(nextControlReview({ frequency: null, lastReviewedOn: '2026-07-15', createdOn: '2025-01-10' })).toBeNull();
  });

  it('classe le suivi : à jour, bientôt dû (15 jours), en retard, sans fréquence', () => {
    expect(controlReviewState({ frequency: 'semestrielle', lastReviewedOn: '2026-06-01', createdOn: '2025-01-01' }, TODAY)).toBe('a_jour');
    expect(controlReviewState({ frequency: 'trimestrielle', lastReviewedOn: '2026-07-15', createdOn: '2025-01-01' }, TODAY)).toBe('bientot');
    expect(controlReviewState({ frequency: 'trimestrielle', lastReviewedOn: '2026-06-30', createdOn: '2025-01-01' }, TODAY)).toBe('en_retard');
    expect(controlReviewState({ frequency: 'annuelle', lastReviewedOn: null, createdOn: '2025-03-01' }, TODAY)).toBe('en_retard');
    expect(controlReviewState({ frequency: null, lastReviewedOn: null, createdOn: '2025-03-01' }, TODAY)).toBe('sans_frequence');
  });
});

describe('consigner une revue', () => {
  it('les gestionnaires et l’auditeur consignent ; le lecteur, non', () => {
    expect(canRecordControlReview('rssi')).toBe(true);
    expect(canRecordControlReview('contributeur')).toBe(true);
    expect(canRecordControlReview('auditeur')).toBe(true);
    expect(canRecordControlReview('lecteur')).toBe(false);
  });

  it('un contrôle défaillant exige des observations ; une revue n’est pas datée dans le futur', () => {
    expect(controlReviewError({ result: 'efficace', observations: null, reviewedOn: TODAY }, TODAY)).toBeNull();
    expect(controlReviewError({ result: 'inefficace', observations: 'ko', reviewedOn: TODAY }, TODAY)).toMatch(/10 caractères/);
    expect(controlReviewError({ result: 'partiellement_efficace', observations: 'Deux comptes sans MFA sur 40 testés.', reviewedOn: TODAY }, TODAY)).toBeNull();
    expect(controlReviewError({ result: 'efficace', observations: null, reviewedOn: '2026-10-08' }, TODAY)).toMatch(/futur/);
  });

  it('propose une action corrective plus urgente pour un contrôle inefficace', () => {
    expect(reviewNeedsCorrection('efficace')).toBe(false);
    expect(controlCorrectiveAction('MFA sur les accès distants', 'inefficace')).toEqual({
      title: 'Rétablir l’efficacité du contrôle « MFA sur les accès distants »', priority: 'p1',
    });
    expect(controlCorrectiveAction('MFA', 'partiellement_efficace').priority).toBe('p2');
    expect(controlCorrectiveAction('x'.repeat(400), 'inefficace').title.length).toBeLessThanOrEqual(200);
  });
});
