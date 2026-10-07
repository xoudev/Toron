import { describe, expect, it } from 'vitest';

import { assignmentTitle, decisionRecipients, exceptionDecisionTitle, notificationHref, shouldNotifyAssignment } from './notifications.ts';

describe('notifications d’attribution', () => {
  it('prévient le nouveau responsable, pas celui qui s’attribue l’objet', () => {
    expect(shouldNotifyAssignment({ actorUserId: 'a', previousOwnerId: null, nextOwnerId: 'b' })).toBe(true);
    expect(shouldNotifyAssignment({ actorUserId: 'a', previousOwnerId: 'c', nextOwnerId: 'b' })).toBe(true);
    expect(shouldNotifyAssignment({ actorUserId: 'a', previousOwnerId: null, nextOwnerId: 'a' })).toBe(false);
  });

  it('ne recrée pas de notification quand le responsable ne change pas ou est retiré', () => {
    expect(shouldNotifyAssignment({ actorUserId: 'a', previousOwnerId: 'b', nextOwnerId: 'b' })).toBe(false);
    expect(shouldNotifyAssignment({ actorUserId: 'a', previousOwnerId: 'b', nextOwnerId: null })).toBe(false);
  });

  it('pointe vers l’objet dans son écran', () => {
    expect(notificationHref('meridiane-logistics', 'obligation', 'd0000000-0000-4000-8000-000000000151'))
      .toBe('/t/meridiane-logistics/obligations?ouvrir=d0000000-0000-4000-8000-000000000151');
    expect(notificationHref('acme', 'traitement', 'x')).toBe('/t/acme/traitements?ouvrir=x');
  });

  it('formule un libellé lisible et borné', () => {
    expect(assignmentTitle('action', '  Durcir   la messagerie ')).toBe('Une action vous est confiée : Durcir la messagerie');
    expect(assignmentTitle('risque', 'x'.repeat(300)).length).toBeLessThanOrEqual(190);
  });
});

describe('notifications de décision', () => {
  it('préviennent le demandeur et le responsable, une fois chacun, jamais le décideur', () => {
    expect(decisionRecipients({ actorUserId: 'd', requestedBy: 'a', ownerUserId: 'b' })).toEqual(['a', 'b']);
    expect(decisionRecipients({ actorUserId: 'd', requestedBy: 'a', ownerUserId: 'a' })).toEqual(['a']);
    expect(decisionRecipients({ actorUserId: 'a', requestedBy: 'a', ownerUserId: 'b' })).toEqual(['b']);
  });

  it('disent si la dérogation est accordée ou refusée, et mènent à son écran', () => {
    expect(exceptionDecisionTitle(true, 'Trieuse sans antivirus')).toBe('Dérogation accordée : Trieuse sans antivirus');
    expect(exceptionDecisionTitle(false, 'Compte partagé')).toBe('Dérogation refusée : Compte partagé');
    expect(notificationHref('acme', 'derogation', 'x')).toBe('/t/acme/derogations?ouvrir=x');
  });
});