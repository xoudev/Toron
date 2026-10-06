import { describe, expect, it } from 'vitest';

import {
  processingGaps,
  processingReviewDue,
  processingWarnings,
  processorAgreementState,
  type ProcessingFacts,
} from './processing.ts';

const complete: ProcessingFacts = {
  purpose: 'Suivi des livraisons et preuve de remise',
  legalBasis: 'contrat',
  legalBasisDetail: null,
  dataSubjects: ['Destinataires des colis'],
  dataCategories: ['Identité', 'Adresse de livraison', 'Signature'],
  sensitiveData: false,
  recipients: 'Clients donneurs d’ordre',
  transfersOutsideEu: false,
  transferSafeguards: null,
  retention: '3 ans après la livraison',
  securityMeasures: 'Accès nominatifs, MFA, chiffrement au repos',
};

describe('fiche de traitement (article 30)', () => {
  it('une fiche complète ne présente aucun manque', () => {
    expect(processingGaps(complete)).toEqual([]);
  });

  it('liste les rubriques vides dans l’ordre de la fiche', () => {
    expect(processingGaps({ ...complete, dataSubjects: [], retention: '  ', securityMeasures: null })).toEqual([
      'Personnes concernées', 'Durée de conservation', 'Mesures de sécurité',
    ]);
  });

  it('exige la description de l’intérêt légitime et les garanties d’un transfert hors UE', () => {
    expect(processingGaps({ ...complete, legalBasis: 'interet_legitime' })).toEqual(['Intérêt légitime poursuivi']);
    expect(processingGaps({ ...complete, transfersOutsideEu: true })).toEqual(['Garanties des transferts hors UE']);
  });

  it('signale les points d’attention sans les compter comme manques', () => {
    expect(processingWarnings(complete)).toEqual([]);
    expect(processingWarnings({ ...complete, sensitiveData: true, legalBasis: 'consentement' })).toHaveLength(2);
  });

  it('prévoit une révision annuelle', () => {
    expect(processingReviewDue('2025-11-14')).toBe('2026-11-14');
    expect(processingReviewDue(null)).toBeNull();
  });
});

describe('sous-traitants (article 28)', () => {
  it('lit l’accord de traitement dans les attestations du fournisseur', () => {
    const base = { supplierId: 's', name: 'Hébergeur' };
    expect(processorAgreementState({ ...base, dpaValidUntil: null }, '2026-10-06')).toBe('couvert');
    expect(processorAgreementState({ ...base, dpaValidUntil: '2027-01-01' }, '2026-10-06')).toBe('couvert');
    expect(processorAgreementState({ ...base, dpaValidUntil: '2026-09-30' }, '2026-10-06')).toBe('expire');
    expect(processorAgreementState({ ...base, dpaValidUntil: undefined }, '2026-10-06')).toBe('absent');
  });
});
