import { describe, expect, it } from 'vitest';

import {
  PORTAL_COMMENT_MAX, cleanPortalDraft, portalAccess, portalExpiresOn, portalMissing, supplierRequestError,
  supplierRequestState, supplierResponseRecipients, supplierResponseTitle,
} from './supplier-portal.ts';
import { SUPPLIER_QUESTIONS } from './suppliers.ts';

describe('cycle d’une demande', () => {
  it('le lien vit deux semaines après l’échéance', () => {
    expect(portalExpiresOn('2026-11-02')).toBe('2026-11-16');
  });

  it('une demande ouverte dont le lien a expiré apparaît « expirée »', () => {
    expect(supplierRequestState('envoyee', '2026-10-07', '2026-10-08')).toBe('expiree');
    expect(supplierRequestState('en_cours', '2026-10-08', '2026-10-08')).toBe('en_cours');
    expect(supplierRequestState('soumise', '2026-10-01', '2026-10-08')).toBe('soumise');
  });

  it('échéance : demain au plus tôt, trois mois au plus tard', () => {
    expect(supplierRequestError({ dueOn: '2026-10-08', today: '2026-10-08' })).toMatch(/postérieure/);
    expect(supplierRequestError({ dueOn: '2026-10-09', today: '2026-10-08' })).toBeNull();
    expect(supplierRequestError({ dueOn: '2027-01-06', today: '2026-10-08' })).toBeNull();
    expect(supplierRequestError({ dueOn: '2027-01-07', today: '2026-10-08' })).toMatch(/trop lointaine/);
  });
});

describe('accès au portail', () => {
  it('ouvert tant que le lien vit et que rien n’est soumis', () => {
    expect(portalAccess('envoyee', '2026-10-08', '2026-10-08')).toBe('ouvert');
    expect(portalAccess('en_cours', '2026-10-07', '2026-10-08')).toBe('expire');
  });

  it('une réponse soumise ne se modifie plus ; annulée ou validée, le lien est clos', () => {
    expect(portalAccess('soumise', '2026-12-01', '2026-10-08')).toBe('soumis');
    expect(portalAccess('annulee', '2026-12-01', '2026-10-08')).toBe('clos');
    expect(portalAccess('validee', '2026-12-01', '2026-10-08')).toBe('clos');
  });
});

describe('réponses reçues du portail', () => {
  it('ne garde que les questions connues et les réponses prévues', () => {
    const d = cleanPortalDraft(
      { mfa: 'oui', chiffrement: 'peut-etre', inconnue: 'oui', rgpd: 'na', gouvernance: 3 },
      { mfa: '  Jetons matériels pour les administrateurs  ', inconnue: 'x', rgpd: '   ' },
    );
    expect(d.answers).toEqual({ mfa: 'oui', rgpd: 'na' });
    expect(d.comments).toEqual({ mfa: 'Jetons matériels pour les administrateurs' });
  });

  it('borne la longueur des commentaires', () => {
    const d = cleanPortalDraft({}, { mfa: 'a'.repeat(PORTAL_COMMENT_MAX + 50) });
    expect(d.comments['mfa']).toHaveLength(PORTAL_COMMENT_MAX);
  });

  it('liste les questions sans réponse, dans l’ordre', () => {
    expect(portalMissing({})).toEqual(SUPPLIER_QUESTIONS.map((q) => q.key));
    const all = Object.fromEntries(SUPPLIER_QUESTIONS.map((q) => [q.key, 'oui' as const]));
    expect(portalMissing(all)).toEqual([]);
    const withoutMfa = Object.fromEntries(Object.entries(all).filter(([k]) => k !== 'mfa'));
    expect(portalMissing(withoutMfa)).toEqual(['mfa']);
  });
});

describe('réponse reçue', () => {
  it('prévient le demandeur et le responsable, une seule fois chacun', () => {
    expect(supplierResponseRecipients({ requestedBy: 'u1', ownerUserId: 'u2' })).toEqual(['u1', 'u2']);
    expect(supplierResponseRecipients({ requestedBy: 'u1', ownerUserId: 'u1' })).toEqual(['u1']);
    expect(supplierResponseRecipients({ requestedBy: null, ownerUserId: null })).toEqual([]);
  });

  it('libellé borné', () => {
    expect(supplierResponseTitle('  Transports   Ardent ')).toBe('Questionnaire rempli par le fournisseur : Transports Ardent');
    expect(supplierResponseTitle('x'.repeat(300)).length).toBeLessThan(220);
  });
});
