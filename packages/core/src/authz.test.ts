import { describe, expect, it } from 'vitest';

import {
  MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLE_PURPOSE,
  PERMISSION_MODULES,
  canManageControls,
  modulePermission,
  tenantAccessVerdict,
  totpRequiredForRole,
} from './authz.ts';
import { isLeaderRole } from './training.ts';

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

describe('MEMBERSHIP_ROLE_PURPOSE (descriptions affichées à l’invitation)', () => {
  it('pilote et contributeur ont bien les mêmes droits, module par module', () => {
    for (const m of PERMISSION_MODULES) {
      expect(modulePermission('pilote', m.key), m.key).toBe(modulePermission('contributeur', m.key));
    }
    expect(MEMBERSHIP_ROLE_PURPOSE.pilote).toContain('Mêmes droits que Contributeur');
  });

  it('responsable qualité et RSSI ont bien les mêmes droits, module par module', () => {
    for (const m of PERMISSION_MODULES) {
      expect(modulePermission('resp_qualite', m.key), m.key).toBe(modulePermission('rssi', m.key));
    }
    expect(MEMBERSHIP_ROLE_PURPOSE.resp_qualite).toContain('Mêmes droits que RSSI');
  });

  it('RSSI : gestion partout sauf les membres, comme annoncé', () => {
    for (const m of PERMISSION_MODULES) {
      if (m.key === 'journal') continue;
      expect(modulePermission('rssi', m.key), m.key).toBe(m.key === 'membres' ? 'lecture' : 'gestion');
    }
    expect(MEMBERSHIP_ROLE_PURPOSE.rssi).toMatch(/^Tous les droits sauf la gestion des membres/);
  });

  it('direction : mêmes droits que le propriétaire sur chaque module, comme annoncé', () => {
    for (const m of PERMISSION_MODULES) {
      expect(modulePermission('direction', m.key), m.key).toBe(modulePermission('owner', m.key));
    }
    expect(MEMBERSHIP_ROLE_PURPOSE.direction).toMatch(/^Tous les droits sauf/);
  });

  it('annonce le suivi « dirigeant » NIS 2 pour les seuls rôles concernés', () => {
    for (const role of MEMBERSHIP_ROLES) {
      expect(MEMBERSHIP_ROLE_PURPOSE[role].includes('dirigeant'), role).toBe(isLeaderRole(role));
    }
  });

  it('ne promet aucune fonction absente de l’application', () => {
    for (const role of MEMBERSHIP_ROLES) {
      expect(MEMBERSHIP_ROLE_PURPOSE[role]).not.toMatch(/factur/i);
    }
  });
});
