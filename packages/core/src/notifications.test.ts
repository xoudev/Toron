import { describe, expect, it } from 'vitest';

import { assignmentTitle, notificationHref, shouldNotifyAssignment } from './notifications.ts';

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
