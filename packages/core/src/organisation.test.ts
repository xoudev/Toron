import { describe, expect, it } from 'vitest';

import {
  MEMBERSHIP_ROLES, PERMISSION_MODULES, assignableRoles, canManageMembers, memberRemovalVerdict,
  memberRoleChangeVerdict, modulePermission,
} from './authz.ts';
import {
  canConfigureOrganisation, invitationAcceptanceVerdict, invitationExpiry, invitationState,
  managementSystemLabel, organisationHeadline, organisationSummary,
} from './organisation.ts';

describe('configuration de l’organisation', () => {
  it('réserve la configuration aux responsables sans élargir les accès des contributeurs', () => {
    for (const role of MEMBERSHIP_ROLES) {
      expect(canConfigureOrganisation(role)).toBe(['owner', 'direction', 'rssi', 'resp_qualite'].includes(role));
    }
  });
  it('ne remplace pas un effectif inconnu par les données de démonstration', () => {
    expect(organisationSummary({ scopeCount: 0, siteCount: 0, employeeCount: null })).toBe('0 périmètre · 0 site');
    expect(organisationSummary({ scopeCount: 2, siteCount: 3, employeeCount: 148 })).toBe('2 périmètres · 3 sites · 148 salariés');
  });
  it('déduit le système de management des périmètres réels', () => {
    expect(managementSystemLabel([])).toBe('Aucun périmètre défini');
    expect(managementSystemLabel(['smsi'])).toBe('Périmètre SMSI');
    expect(managementSystemLabel(['qms', 'qms'])).toBe('Périmètre QMS');
    expect(managementSystemLabel(['smsi', 'qms'])).toBe('Périmètre SMSI + QMS');
    expect(managementSystemLabel(['mixte'])).toBe('Périmètre SMSI + QMS');
    expect(organisationHeadline({ scopeKinds: ['mixte'], siteCount: 3, employeeCount: 148 }))
      .toBe('Périmètre SMSI + QMS · 148 salariés · 3 sites');
    expect(organisationHeadline({ scopeKinds: [], siteCount: 0, employeeCount: null })).toBe('Aucun périmètre défini');
  });
});

describe('gestion des membres', () => {
  const base = { actorUserId: 'u-admin', targetUserId: 'u-cible', ownerCount: 2 };

  it('réserve la gestion des accès au propriétaire et à la direction', () => {
    for (const role of MEMBERSHIP_ROLES) {
      expect(canManageMembers(role)).toBe(role === 'owner' || role === 'direction');
    }
    expect(assignableRoles('owner')).toEqual([...MEMBERSHIP_ROLES]);
    expect(assignableRoles('direction')).not.toContain('owner');
    expect(assignableRoles('rssi')).toEqual([]);
  });
  it('autorise un changement de rôle ordinaire', () => {
    expect(memberRoleChangeVerdict({ ...base, actorRole: 'direction', targetRole: 'lecteur', newRole: 'rssi' })).toEqual({ ok: true });
  });
  it('empêche de modifier son propre rôle', () => {
    const v = memberRoleChangeVerdict({ ...base, targetUserId: 'u-admin', actorRole: 'owner', targetRole: 'owner', newRole: 'lecteur' });
    expect(v.ok).toBe(false);
  });
  it('protège le dernier propriétaire contre la rétrogradation et le retrait', () => {
    expect(memberRoleChangeVerdict({ ...base, ownerCount: 1, actorRole: 'owner', targetRole: 'owner', newRole: 'direction' }).ok).toBe(false);
    expect(memberRemovalVerdict({ ...base, ownerCount: 1, actorRole: 'owner', targetRole: 'owner' }).ok).toBe(false);
    expect(memberRoleChangeVerdict({ ...base, ownerCount: 2, actorRole: 'owner', targetRole: 'owner', newRole: 'direction' }).ok).toBe(true);
  });
  it('interdit à la direction de toucher aux propriétaires ou d’en nommer', () => {
    expect(memberRoleChangeVerdict({ ...base, actorRole: 'direction', targetRole: 'owner', newRole: 'direction' }).ok).toBe(false);
    expect(memberRoleChangeVerdict({ ...base, actorRole: 'direction', targetRole: 'rssi', newRole: 'owner' }).ok).toBe(false);
    expect(memberRemovalVerdict({ ...base, actorRole: 'direction', targetRole: 'owner' }).ok).toBe(false);
  });
  it('refuse toute gestion aux autres rôles', () => {
    expect(memberRoleChangeVerdict({ ...base, actorRole: 'rssi', targetRole: 'lecteur', newRole: 'contributeur' }).ok).toBe(false);
    expect(memberRemovalVerdict({ ...base, actorRole: 'contributeur', targetRole: 'lecteur' }).ok).toBe(false);
  });
});

describe('matrice de permissions', () => {
  it('rend visible la séparation des tâches de l’auditeur', () => {
    expect(modulePermission('auditeur', 'audits')).toBe('constat');
    expect(modulePermission('auditeur', 'referentiels')).toBe('lecture');
    expect(modulePermission('auditeur', 'risques')).toBe('lecture');
  });
  it('couvre chaque module pour chaque rôle sans trou', () => {
    for (const role of MEMBERSHIP_ROLES) {
      for (const m of PERMISSION_MODULES) {
        expect(['gestion', 'constat', 'lecture', 'aucun']).toContain(modulePermission(role, m.key));
      }
    }
    expect(modulePermission('lecteur', 'plan_action')).toBe('lecture');
    expect(modulePermission('owner', 'membres')).toBe('gestion');
    expect(modulePermission('rssi', 'membres')).toBe('lecture');
    expect(modulePermission('rssi', 'organisation')).toBe('gestion');
  });
});

describe('invitations', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  const pending = { email: 'invite@example.test', expiresAt: invitationExpiry(now), acceptedAt: null, revokedAt: null };

  it('expire au bout de sept jours', () => {
    expect(invitationExpiry(now).toISOString()).toBe('2026-10-12T10:00:00.000Z');
    expect(invitationState(pending, now)).toBe('en_attente');
    expect(invitationState(pending, new Date('2026-10-12T10:00:00Z'))).toBe('expiree');
    expect(invitationState({ ...pending, acceptedAt: now }, now)).toBe('acceptee');
    expect(invitationState({ ...pending, revokedAt: now }, now)).toBe('revoquee');
  });
  it('n’est consommable que par le compte dont l’adresse correspond', () => {
    expect(invitationAcceptanceVerdict({ invitation: pending, sessionEmail: 'Invite@Example.test', now })).toEqual({ ok: true });
    expect(invitationAcceptanceVerdict({ invitation: pending, sessionEmail: 'autre@example.test', now }).ok).toBe(false);
    expect(invitationAcceptanceVerdict({ invitation: { ...pending, revokedAt: now }, sessionEmail: pending.email, now }).ok).toBe(false);
    expect(invitationAcceptanceVerdict({ invitation: pending, sessionEmail: pending.email, now: new Date('2026-11-01') }).ok).toBe(false);
  });
});
