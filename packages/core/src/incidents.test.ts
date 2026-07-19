import { describe, expect, it } from 'vitest';

import { canCloseIncident, deadlineState, hoursUntil, nis2Deadlines } from './incidents.ts';

const qualifiedAt = new Date('2026-07-18T08:00:00Z');

describe('échéancier NIS 2 calculé à la qualification (RM §6.1)', () => {
  it('pose alerte 24 h, notification 72 h, rapport J+30', () => {
    const plans = nis2Deadlines(qualifiedAt, false);
    const by = Object.fromEntries(plans.map((p) => [p.kind, p.dueAt.toISOString()]));
    expect(by.alerte_24h).toBe('2026-07-19T08:00:00.000Z');
    expect(by.notification_72h).toBe('2026-07-21T08:00:00.000Z');
    expect(by.rapport_30j).toBe('2026-08-17T08:00:00.000Z');
    expect(by.cnil_72h).toBeUndefined();
  });

  it('ajoute le volet RGPD CNIL 72 h si violation de données', () => {
    const plans = nis2Deadlines(qualifiedAt, true);
    const cnil = plans.find((p) => p.kind === 'cnil_72h');
    expect(cnil?.dueAt.toISOString()).toBe('2026-07-21T08:00:00.000Z');
  });
});

describe('état d’échéance (compte à rebours)', () => {
  const due = new Date('2026-07-19T08:00:00Z');
  it('faite si transmise', () => {
    expect(deadlineState(due, new Date('2026-07-19T07:00:00Z'), new Date('2026-07-19T07:30:00Z'))).toBe('faite');
  });
  it('à venir, proche (< 12 h), dépassée', () => {
    expect(deadlineState(due, null, new Date('2026-07-18T08:00:00Z'))).toBe('a_venir'); // 24 h avant
    expect(deadlineState(due, null, new Date('2026-07-19T00:00:00Z'))).toBe('proche'); // 8 h avant
    expect(deadlineState(due, null, new Date('2026-07-19T10:00:00Z'))).toBe('depasse');
  });
  it('heures restantes', () => {
    expect(hoursUntil(due, new Date('2026-07-18T08:00:00Z'))).toBe(24);
    expect(hoursUntil(due, new Date('2026-07-19T10:00:00Z'))).toBe(-2);
  });
});

describe('clôture — REX obligatoire si important (RM §6.1)', () => {
  it('incident non important : clôture libre', () => {
    expect(canCloseIncident({ nis2Important: false, rex: null })).toBe(true);
  });
  it('incident important : clôture interdite sans REX', () => {
    expect(canCloseIncident({ nis2Important: true, rex: null })).toBe(false);
    expect(canCloseIncident({ nis2Important: true, rex: '   ' })).toBe(false);
    expect(canCloseIncident({ nis2Important: true, rex: 'Cause racine corrigée, MFA généralisé.' })).toBe(true);
  });
});
