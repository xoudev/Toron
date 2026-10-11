import { describe, expect, it } from 'vitest';

import {
  CIRCUIT_CLOSED, LEASE_SECONDS, MAX_SEND_ATTEMPTS, MIN_SEND_MARGIN_SECONDS, circuitGate, circuitNext,
  classifyProviderResponse, isReservedRecipient, nextAttemptAt, recipientAllowed, type CircuitState, type ProviderVerdict,
} from './email.ts';

const NOW = new Date('2026-10-10T12:00:00Z');
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const IN_TWO_DAYS = at(48 * 3600);

describe('reprises', () => {
  it('constantes de la file', () => {
    expect(MIN_SEND_MARGIN_SECONDS).toBe(300);
    expect(MAX_SEND_ATTEMPTS).toBe(6);
    expect(LEASE_SECONDS).toBe(120);
  });

  it('paliers de 30 s, 2 min, 10 min, 30 min puis 2 h', () => {
    expect([1, 2, 3, 4, 5].map((n) => nextAttemptAt(NOW, n, IN_TWO_DAYS))).toEqual([
      at(30), at(120), at(600), at(1800), at(7200),
    ]);
  });

  it('plus aucune reprise après la sixième tentative, ni pour un compteur invalide', () => {
    expect(nextAttemptAt(NOW, 6, IN_TWO_DAYS)).toBeNull();
    expect(nextAttemptAt(NOW, 7, IN_TWO_DAYS)).toBeNull();
    expect(nextAttemptAt(NOW, 0, IN_TWO_DAYS)).toBeNull();
    expect(nextAttemptAt(NOW, 1.5, IN_TWO_DAYS)).toBeNull();
  });

  it('plafonnée par l’expiration moins la marge d’envoi', () => {
    // Lien de 30 min : la reprise à +30 s tient, celle à +30 min non.
    const expires = at(1800);
    expect(nextAttemptAt(NOW, 1, expires)).toEqual(at(30));
    expect(nextAttemptAt(NOW, 3, expires)).toEqual(at(600));
    expect(nextAttemptAt(NOW, 4, expires)).toBeNull();
    // Borne exacte : une reprise qui tombe pile dans la marge serait expirée à la réclamation.
    expect(nextAttemptAt(NOW, 1, at(30 + 300))).toBeNull();
    expect(nextAttemptAt(NOW, 1, at(30 + 301))).toEqual(at(30));
  });

  it('un Retry-After plus long fait plancher, un plus court est ignoré', () => {
    expect(nextAttemptAt(NOW, 1, IN_TWO_DAYS, 90)).toEqual(at(90));
    expect(nextAttemptAt(NOW, 2, IN_TWO_DAYS, 10)).toEqual(at(120));
    expect(nextAttemptAt(NOW, 1, IN_TWO_DAYS, Number.NaN)).toEqual(at(30));
    expect(nextAttemptAt(NOW, 1, IN_TWO_DAYS, -5)).toEqual(at(30));
    expect(nextAttemptAt(NOW, 1, at(1800), 3600)).toBeNull();
  });
});

describe('classification des réponses du fournisseur', () => {
  it.each([
    [200, { effect: 'envoye' }],
    [202, { effect: 'envoye' }],
    [429, { effect: 'reprise', code: 'LIMITE_FOURNISSEUR' }],
    [500, { effect: 'reprise', code: 'FOURNISSEUR_INDISPONIBLE' }],
    [503, { effect: 'reprise', code: 'FOURNISSEUR_INDISPONIBLE' }],
    ['reseau', { effect: 'reprise', code: 'RESEAU' }],
    ['delai', { effect: 'reprise', code: 'DELAI' }],
    [408, { effect: 'reprise', code: 'DELAI' }],
    [401, { effect: 'liberation', code: 'CONFIGURATION' }],
    [403, { effect: 'liberation', code: 'CONFIGURATION' }],
    [404, { effect: 'liberation', code: 'CONFIGURATION' }],
    [400, { effect: 'definitif', code: 'REFUS_FOURNISSEUR' }],
    [422, { effect: 'definitif', code: 'REFUS_FOURNISSEUR' }],
    [413, { effect: 'definitif', code: 'REFUS_FOURNISSEUR' }],
    [302, { effect: 'reprise', code: 'FOURNISSEUR_INDISPONIBLE' }],
  ] as const)('%s', (response, expected) => {
    expect(classifyProviderResponse(response)).toEqual(expected);
  });

  it('les codes respectent la contrainte last_error_code de la table', () => {
    for (const r of [400, 401, 408, 429, 503, 'reseau', 'delai'] as const) {
      const v = classifyProviderResponse(r);
      if (v.effect !== 'envoye') expect(v.code).toMatch(/^[A-Z_]{3,40}$/);
    }
  });
});

describe('disjoncteur', () => {
  const sent: ProviderVerdict = { effect: 'envoye' };
  const down: ProviderVerdict = { effect: 'reprise', code: 'FOURNISSEUR_INDISPONIBLE' };
  const config: ProviderVerdict = { effect: 'liberation', code: 'CONFIGURATION' };
  const refused: ProviderVerdict = { effect: 'definitif', code: 'REFUS_FOURNISSEUR' };

  function failTimes(n: number, from: CircuitState = CIRCUIT_CLOSED, when = NOW): CircuitState {
    let s = from;
    for (let i = 0; i < n; i += 1) s = circuitNext(s, down, when);
    return s;
  }

  it('reste fermé sous cinq échecs transitoires consécutifs', () => {
    const s = failTimes(4);
    expect(s).toMatchObject({ phase: 'ferme', consecutiveFailures: 4 });
    expect(circuitGate(s, NOW).allowed).toBe(true);
  });

  it('un envoi réussi ou un refus du fournisseur remet le compteur à zéro', () => {
    expect(circuitNext(failTimes(4), sent, NOW)).toEqual(CIRCUIT_CLOSED);
    expect(circuitNext(failTimes(4), refused, NOW)).toEqual(CIRCUIT_CLOSED);
  });

  it('cinq échecs consécutifs l’ouvrent 60 s', () => {
    const s = failTimes(5);
    expect(s).toEqual({ phase: 'ouvert', consecutiveFailures: 0, trips: 1, openUntil: at(60).getTime() });
    expect(circuitGate(s, at(59)).allowed).toBe(false);
  });

  it('semi-ouverture : un seul essai à l’échéance', () => {
    const open = failTimes(5);
    const gate = circuitGate(open, at(60));
    expect(gate.allowed).toBe(true);
    expect(gate.state.phase).toBe('semi_ouvert');
    expect(circuitGate(gate.state, at(61)).allowed).toBe(false);
    expect(circuitNext(gate.state, sent, at(61))).toEqual(CIRCUIT_CLOSED);
  });

  it('chaque récidive double la durée, jusqu’à 15 min', () => {
    let s = failTimes(5);
    const durations: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const failedAt = new Date(s.openUntil!);
      s = circuitNext(circuitGate(s, failedAt).state, down, failedAt);
      durations.push((s.openUntil! - failedAt.getTime()) / 1000);
    }
    expect(durations).toEqual([120, 240, 480, 900, 900, 900]);
  });

  it('un échec transitoire pendant l’ouverture ne la prolonge pas', () => {
    const open = failTimes(5);
    expect(circuitNext(open, down, at(30))).toEqual(open);
  });

  it('une erreur de configuration l’ouvre 5 min, sans compter de récidive', () => {
    const s = circuitNext(CIRCUIT_CLOSED, config, NOW);
    expect(s).toEqual({ phase: 'ouvert', consecutiveFailures: 0, trips: 0, openUntil: at(300).getTime() });
    const probe = circuitGate(s, at(300));
    expect(circuitNext(probe.state, config, at(300)).openUntil).toBe(at(600).getTime());
  });

  it('l’état survit à un aller-retour JSON', () => {
    const s = failTimes(5);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('destinataires', () => {
  it.each([
    'camille.poirier@meridiane-logistics.example',
    'essai@toron.test',
    'x@service.invalid',
    'root@localhost',
    'a@example.com',
    'a@mail.example.org',
    'A@EXAMPLE.NET',
    'a@toron.test.',
    'sans-domaine',
    'fin@',
  ])('%s est réservé', (address) => {
    expect(isReservedRecipient(address)).toBe(true);
  });

  it.each(['rssi@meridiane.fr', 'a@example.fr', 'a@notexample.com', 'a@testing.eu'])('%s ne l’est pas', (address) => {
    expect(isReservedRecipient(address)).toBe(false);
  });

  it('liste blanche par domaine ou par adresse, insensible à la casse', () => {
    const list = ['Meridiane.fr', '@toron.eu', 'jordan@exemple.fr', '  '];
    expect(recipientAllowed('RSSI@meridiane.FR', list)).toBe(true);
    expect(recipientAllowed('qa@toron.eu', list)).toBe(true);
    expect(recipientAllowed('Jordan@Exemple.fr', list)).toBe(true);
    expect(recipientAllowed('autre@exemple.fr', list)).toBe(false);
    expect(recipientAllowed('rssi@sous.meridiane.fr', list)).toBe(false);
    expect(recipientAllowed('rssi@meridiane.fr.pirate.io', list)).toBe(false);
    expect(recipientAllowed('sans-domaine', list)).toBe(false);
    expect(recipientAllowed('rssi@meridiane.fr', [])).toBe(false);
  });
});
