import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION_FILTERS, AUDIT_ACTION_LABEL, AUDIT_OBJECT_LABEL, auditActionLabel, auditObjectLabel,
} from './audit-labels.ts';

describe('libellés du journal d’audit', () => {
  it('traduit les codes courants du parcours d’installation', () => {
    expect(auditActionLabel('membership.change_role')).toBe('Changement de rôle');
    expect(auditActionLabel('framework.activate')).toBe('Activation d’un référentiel');
    expect(auditActionLabel('invitation.create')).toBe('Invitation d’un membre');
    expect(auditObjectLabel('legal_entity')).toBe('Entité juridique');
    expect(auditObjectLabel('membership')).toBe('Membre');
  });

  it('affiche tel quel un code inconnu plutôt que de le masquer', () => {
    expect(auditActionLabel('module.inconnu')).toBe('module.inconnu');
    expect(auditObjectLabel('objet_inconnu')).toBe('objet_inconnu');
  });

  it('ne confond pas un code avec une propriété héritée', () => {
    expect(auditActionLabel('constructor')).toBe('constructor');
    expect(auditObjectLabel('toString')).toBe('toString');
  });

  it('n’a aucun libellé vide', () => {
    for (const label of [...Object.values(AUDIT_ACTION_LABEL), ...Object.values(AUDIT_OBJECT_LABEL)]) {
      expect(label.trim()).not.toBe('');
    }
  });
});

describe('filtres du journal d’audit', () => {
  const prefixes = AUDIT_ACTION_FILTERS.map((f) => f.prefix);

  it('commence par « Toutes les actions », sans préfixe', () => {
    expect(AUDIT_ACTION_FILTERS[0]).toEqual({ label: 'Toutes les actions', prefix: '' });
  });

  it('n’a ni préfixe ni libellé en double', () => {
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(new Set(AUDIT_ACTION_FILTERS.map((f) => f.label)).size).toBe(AUDIT_ACTION_FILTERS.length);
  });

  it('respecte le format accepté par le serveur (minuscules, point final)', () => {
    for (const p of prefixes.slice(1)) {
      expect(p).toMatch(/^[a-z_]+\.$/);
      expect(p.length).toBeLessThanOrEqual(40);
    }
  });

  it('rattache chaque action libellée à exactement un filtre', () => {
    for (const code of Object.keys(AUDIT_ACTION_LABEL)) {
      const matches = prefixes.filter((p) => p !== '' && code.startsWith(p));
      expect(matches, code).toHaveLength(1);
    }
  });

  it('ne propose aucun filtre qui resterait toujours vide', () => {
    const codes = Object.keys(AUDIT_ACTION_LABEL);
    for (const p of prefixes.slice(1)) {
      expect(codes.some((c) => c.startsWith(p)), p).toBe(true);
    }
  });

  it('sépare périmètres, entités, sites et référentiels de l’organisation', () => {
    const filterOf = (code: string) => AUDIT_ACTION_FILTERS.find((f) => f.prefix !== '' && code.startsWith(f.prefix))?.label;
    expect(filterOf('organisation.update')).toBe('Organisation (profil, modules)');
    expect(filterOf('scope.create')).toBe('Périmètres');
    expect(filterOf('entity.create')).toBe('Entités juridiques');
    expect(filterOf('site.create')).toBe('Sites');
    expect(filterOf('framework.activate')).toBe('Référentiels');
    expect(filterOf('membership.change_role')).toBe('Membres');
    expect(filterOf('invitation.create')).toBe('Invitations');
  });
});
