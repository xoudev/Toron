import { describe, expect, it } from 'vitest';

import {
  MEMBERSHIP_ROLES,
  canManageControls,
  tenantAccessVerdict,
  totpRequiredForRole,
} from './authz.ts';

describe('totpRequiredForRole', () => {
  it('exige le TOTP pour owner, direction et rssi (§8.1)', () => {
    expect(totpRequiredForRole('owner')).toBe(true);
    expect(totpRequiredForRole('direction')).toBe(true);
    expect(totpRequiredForRole('rssi')).toBe(true);
  });

  it("ne l'exige pas pour les autres rôles", () => {
    for (const role of MEMBERSHIP_ROLES) {
      if (role === 'owner' || role === 'direction' || role === 'rssi') continue;
      expect(totpRequiredForRole(role)).toBe(false);
    }
  });
});

describe('tenantAccessVerdict', () => {
  it('refuse sans membership — le serveur décide, pas l’UI (S5)', () => {
    expect(tenantAccessVerdict({ membershipRole: null, twoFactorEnabled: true })).toBe('refuse');
  });

  it('bloque un RSSI sans double authentification', () => {
    expect(tenantAccessVerdict({ membershipRole: 'rssi', twoFactorEnabled: false })).toBe(
      'totp_requis',
    );
  });

  it('autorise un RSSI avec TOTP actif', () => {
    expect(tenantAccessVerdict({ membershipRole: 'rssi', twoFactorEnabled: true })).toBe(
      'autorise',
    );
  });

  it('autorise un lecteur sans TOTP (non requis pour ce rôle)', () => {
    expect(tenantAccessVerdict({ membershipRole: 'lecteur', twoFactorEnabled: false })).toBe(
      'autorise',
    );
  });
});

describe('canManageControls (RBAC module 5.2, S5)', () => {
  it('autorise les rôles opérationnels de conformité', () => {
    for (const role of ['owner', 'direction', 'rssi', 'resp_qualite', 'pilote', 'contributeur'] as const) {
      expect(canManageControls(role)).toBe(true);
    }
  });

  it('refuse le lecteur et l’auditeur (lecture seule, séparation auditeur/audité)', () => {
    expect(canManageControls('lecteur')).toBe(false);
    expect(canManageControls('auditeur')).toBe(false);
  });

  it('couvre exactement les 8 rôles connus', () => {
    const managed = MEMBERSHIP_ROLES.filter(canManageControls);
    expect(managed).toHaveLength(6);
  });
});
