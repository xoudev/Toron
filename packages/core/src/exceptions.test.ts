import { describe, expect, it } from 'vitest';

import { addDaysIso, addMonthsIso } from './dates.ts';
import {
  defaultExceptionWindow,
  exceptionCloseVerdict,
  exceptionDecisionVerdict,
  exceptionEditVerdict,
  exceptionNeedsAttention,
  exceptionRenewalVerdict,
  exceptionState,
  exceptionWindowError,
  maxExceptionExpiry,
  renewalWindow,
  type ExceptionParties,
} from './exceptions.ts';

const TODAY = '2026-10-07';

describe('calendrier des dérogations', () => {
  it('ajoute des mois en ramenant le jour à la fin du mois, comme Postgres', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonthsIso('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsIso('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('ajoute des jours par-dessus les fins de mois et d’année', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('propose six mois par défaut et borne l’échéance à douze mois', () => {
    expect(defaultExceptionWindow(TODAY)).toEqual({ startsOn: TODAY, expiresOn: '2027-04-06' });
    expect(maxExceptionExpiry(TODAY)).toBe('2027-10-07');
  });

  it('refuse une fenêtre inversée, trop longue, déjà échue ou mal formée', () => {
    expect(exceptionWindowError(TODAY, '2027-04-06', TODAY)).toBeNull();
    expect(exceptionWindowError(TODAY, '2027-10-07', TODAY)).toBeNull();
    expect(exceptionWindowError(TODAY, TODAY, TODAY)).toMatch(/suivre la date de début/);
    expect(exceptionWindowError(TODAY, '2027-10-08', TODAY)).toMatch(/12 mois au plus/);
    expect(exceptionWindowError('2026-01-01', '2026-06-30', TODAY)).toMatch(/déjà échue/);
    expect(exceptionWindowError('07/10/2026', '2027-01-01', TODAY)).toMatch(/AAAA-MM-JJ/);
  });
});

describe('état d’une dérogation à une date', () => {
  const approved = { status: 'approuvee' as const, startsOn: '2026-03-01', expiresOn: '2027-01-31', renewal: 'aucun' as const };

  it('suit la décision : en attente, refusée, clôturée', () => {
    expect(exceptionState({ ...approved, status: 'demandee' }, TODAY)).toBe('en_attente');
    expect(exceptionState({ ...approved, status: 'refusee' }, TODAY)).toBe('refusee');
    expect(exceptionState({ ...approved, status: 'cloturee' }, TODAY)).toBe('cloturee');
  });

  it('une dérogation accordée est à venir, en vigueur, à échéance (30 jours) puis échue', () => {
    expect(exceptionState({ ...approved, startsOn: '2026-11-01' }, TODAY)).toBe('a_venir');
    expect(exceptionState(approved, TODAY)).toBe('en_vigueur');
    expect(exceptionState({ ...approved, expiresOn: '2026-11-06' }, TODAY)).toBe('a_echeance');
    // Le dernier jour de validité est inclus.
    expect(exceptionState({ ...approved, expiresOn: TODAY }, TODAY)).toBe('a_echeance');
    expect(exceptionState({ ...approved, expiresOn: '2026-10-06' }, TODAY)).toBe('echue');
  });

  it('un renouvellement accordé lève l’alerte d’échéance et prend la suite', () => {
    expect(exceptionState({ ...approved, expiresOn: '2026-10-20', renewal: 'accorde' }, TODAY)).toBe('en_vigueur');
    expect(exceptionState({ ...approved, expiresOn: '2026-09-30', renewal: 'accorde' }, TODAY)).toBe('renouvelee');
    // Un renouvellement seulement demandé ne couvre rien tant qu'il n'est pas accordé.
    expect(exceptionState({ ...approved, expiresOn: '2026-09-30', renewal: 'demande' }, TODAY)).toBe('echue');
  });

  it('demande une action pour une décision, une échéance proche ou une dérogation échue', () => {
    expect(['en_attente', 'a_echeance', 'echue'].every((s) => exceptionNeedsAttention(s as never))).toBe(true);
    expect(['a_venir', 'en_vigueur', 'renouvelee', 'refusee', 'cloturee'].some((s) => exceptionNeedsAttention(s as never))).toBe(false);
  });
});

describe('droits sur une dérogation', () => {
  const CLAIRE = 'u-claire';
  const ANTOINE = 'u-antoine';
  const CAMILLE = 'u-camille';
  const pending: ExceptionParties = { status: 'demandee', requestedBy: CAMILLE, ownerUserId: CAMILLE };

  it('un décideur statue, jamais sur sa propre demande ni sur celle dont il répond', () => {
    expect(exceptionDecisionVerdict({ role: 'rssi', actorUserId: CLAIRE }, pending)).toEqual({ ok: true });
    expect(exceptionDecisionVerdict({ role: 'direction', actorUserId: ANTOINE }, pending)).toEqual({ ok: true });
    const own = exceptionDecisionVerdict({ role: 'resp_qualite', actorUserId: CAMILLE }, pending);
    expect(own.ok === false && own.reason).toMatch(/séparation des tâches/);
    const owner = exceptionDecisionVerdict({ role: 'rssi', actorUserId: CLAIRE }, { ...pending, ownerUserId: CLAIRE });
    expect(owner.ok === false && owner.reason).toMatch(/responsable de cette dérogation/);
  });

  it('un contributeur, un pilote ou un auditeur ne statue pas ; une décision ne se rejoue pas', () => {
    for (const role of ['contributeur', 'pilote', 'auditeur', 'lecteur'] as const) {
      expect(exceptionDecisionVerdict({ role, actorUserId: CLAIRE }, pending).ok).toBe(false);
    }
    const done = exceptionDecisionVerdict({ role: 'rssi', actorUserId: CLAIRE }, { ...pending, status: 'approuvee' });
    expect(done.ok === false && done.reason).toMatch(/déjà été tranchée/);
  });

  it('la demande se modifie tant qu’elle n’est pas tranchée, par ses parties ou un décideur', () => {
    expect(exceptionEditVerdict({ role: 'contributeur', actorUserId: CAMILLE }, pending).ok).toBe(true);
    expect(exceptionEditVerdict({ role: 'rssi', actorUserId: CLAIRE }, pending).ok).toBe(true);
    expect(exceptionEditVerdict({ role: 'contributeur', actorUserId: 'u-autre' }, pending).ok).toBe(false);
    expect(exceptionEditVerdict({ role: 'lecteur', actorUserId: CAMILLE }, pending).ok).toBe(false);
    expect(exceptionEditVerdict({ role: 'rssi', actorUserId: CLAIRE }, { ...pending, status: 'approuvee' }).ok).toBe(false);
  });

  it('la clôture vaut pour une demande ou une dérogation accordée, jamais deux fois', () => {
    expect(exceptionCloseVerdict({ role: 'contributeur', actorUserId: CAMILLE }, pending).ok).toBe(true);
    expect(exceptionCloseVerdict({ role: 'direction', actorUserId: ANTOINE }, { ...pending, status: 'approuvee' }).ok).toBe(true);
    expect(exceptionCloseVerdict({ role: 'contributeur', actorUserId: 'u-autre' }, pending).ok).toBe(false);
    expect(exceptionCloseVerdict({ role: 'rssi', actorUserId: CLAIRE }, { ...pending, status: 'refusee' }).ok).toBe(false);
    expect(exceptionCloseVerdict({ role: 'rssi', actorUserId: CLAIRE }, { ...pending, status: 'cloturee' }).ok).toBe(false);
  });

  it('on renouvelle une dérogation accordée, une seule fois à la fois', () => {
    const approved = { ...pending, status: 'approuvee' as const, renewal: 'aucun' as const };
    expect(exceptionRenewalVerdict({ role: 'resp_qualite', actorUserId: CAMILLE }, approved).ok).toBe(true);
    expect(exceptionRenewalVerdict({ role: 'resp_qualite', actorUserId: CAMILLE }, { ...approved, renewal: 'demande' }).ok).toBe(false);
    expect(exceptionRenewalVerdict({ role: 'resp_qualite', actorUserId: CAMILLE }, { ...approved, renewal: 'accorde' }).ok).toBe(false);
    expect(exceptionRenewalVerdict({ role: 'resp_qualite', actorUserId: CAMILLE }, { ...approved, status: 'demandee' }).ok).toBe(false);
  });

  it('le renouvellement prend la suite le lendemain de l’échéance, ou dès aujourd’hui si elle est passée', () => {
    expect(renewalWindow('2026-10-31', TODAY)).toEqual({ startsOn: '2026-11-01', expiresOn: '2027-04-30' });
    expect(renewalWindow('2026-09-30', TODAY)).toEqual({ startsOn: TODAY, expiresOn: '2027-04-06' });
  });
});
