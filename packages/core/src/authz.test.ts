import { describe, expect, it } from 'vitest';

import { MEMBERSHIP_ROLES, tenantAccessVerdict, totpRequiredForRole } from './authz.js';

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
