/**
 * Règles d'autorisation transverses (S5, §8.1).
 * Pures et testées — l'UI ne fait que refléter, le serveur décide.
 */

export const MEMBERSHIP_ROLES = [
  'owner',
  'direction',
  'rssi',
  'resp_qualite',
  'pilote',
  'auditeur',
  'contributeur',
  'lecteur',
] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Libellés produit des rôles — une seule source pour toute l'interface. */
export const MEMBERSHIP_ROLE_LABEL: Record<MembershipRole, string> = {
  owner: 'Propriétaire',
  direction: 'Direction',
  rssi: 'RSSI',
  resp_qualite: 'Responsable qualité',
  pilote: 'Pilote de processus',
  auditeur: 'Auditeur',
  contributeur: 'Contributeur',
  lecteur: 'Lecteur',
};

/** Ce que chaque rôle est censé faire, en une phrase, pour guider l'attribution. */
export const MEMBERSHIP_ROLE_PURPOSE: Record<MembershipRole, string> = {
  owner: 'Administre l’organisation, ses membres et sa facturation.',
  direction: 'Arbitre, accepte les risques et préside la revue de direction.',
  rssi: 'Pilote le SMSI : référentiels, risques, incidents, preuves.',
  resp_qualite: 'Pilote le QMS : processus, non-conformités, audits internes.',
  pilote: 'Tient à jour son processus, ses indicateurs et ses actions.',
  auditeur: 'Constate et documente, sans modifier ce qu’il audite.',
  contributeur: 'Réalise des actions et dépose des preuves.',
  lecteur: 'Consulte sans jamais modifier.',
};

/** Rôles à privilèges élevés : TOTP obligatoire dès le MVP (ADR-4, §8.1). */
const TOTP_REQUIRED_ROLES: ReadonlySet<MembershipRole> = new Set([
  'owner',
  'direction',
  'rssi',
]);

export function totpRequiredForRole(role: MembershipRole): boolean {
  return TOTP_REQUIRED_ROLES.has(role);
}

/**
 * Rôles autorisés à gérer les contrôles et le cross-mapping (module 5.2) :
 * créer/mapper/démapper/supprimer un contrôle, créer un référentiel custom.
 * Lecteur et auditeur sont en lecture seule (S5, séparation auditeur/audité) :
 * l'auditeur constate, il ne modifie pas l'objet audité. Le serveur décide,
 * l'UI ne fait que refléter.
 */
const CONTROL_MANAGER_ROLES: ReadonlySet<MembershipRole> = new Set([
  'owner',
  'direction',
  'rssi',
  'resp_qualite',
  'pilote',
  'contributeur',
]);

export function canManageControls(role: MembershipRole): boolean {
  return CONTROL_MANAGER_ROLES.has(role);
}

/**
 * Gestion des membres (inviter, changer un rôle, retirer) : réservée au
 * propriétaire et à la direction. Le RSSI et le responsable qualité
 * configurent le système de management, pas les accès.
 */
const MEMBER_MANAGER_ROLES: ReadonlySet<MembershipRole> = new Set(['owner', 'direction']);

export function canManageMembers(role: MembershipRole): boolean {
  return MEMBER_MANAGER_ROLES.has(role);
}

/**
 * Rôles qu'un acteur peut attribuer : seul un propriétaire nomme un autre
 * propriétaire ; la direction gère tous les autres rôles.
 */
export function assignableRoles(actorRole: MembershipRole): MembershipRole[] {
  if (actorRole === 'owner') return [...MEMBERSHIP_ROLES];
  if (actorRole === 'direction') return MEMBERSHIP_ROLES.filter((r) => r !== 'owner');
  return [];
}

export type MemberChangeVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Changement de rôle d'un membre. Une organisation garde toujours au moins
 * un propriétaire, un acteur ne modifie pas son propre rôle (pas
 * d'auto-verrouillage), et la direction ne touche pas aux propriétaires.
 */
export function memberRoleChangeVerdict(input: {
  actorRole: MembershipRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: MembershipRole;
  newRole: MembershipRole;
  ownerCount: number;
}): MemberChangeVerdict {
  if (!canManageMembers(input.actorRole)) {
    return { ok: false, reason: 'Seuls le propriétaire et la direction attribuent les rôles.' };
  }
  if (input.actorUserId === input.targetUserId) {
    return { ok: false, reason: 'Vous ne pouvez pas modifier votre propre rôle — demandez à un autre responsable.' };
  }
  if (input.targetRole === 'owner' && input.actorRole !== 'owner') {
    return { ok: false, reason: 'Le rôle d’un propriétaire ne peut être modifié que par un autre propriétaire.' };
  }
  if (!assignableRoles(input.actorRole).includes(input.newRole)) {
    return { ok: false, reason: 'Ce rôle dépasse vos droits d’attribution.' };
  }
  if (input.targetRole === 'owner' && input.newRole !== 'owner' && input.ownerCount <= 1) {
    return { ok: false, reason: 'Nommez d’abord un autre propriétaire : l’organisation ne peut pas rester sans propriétaire.' };
  }
  return { ok: true };
}

/** Retrait d'un membre : mêmes garde-fous que le changement de rôle. */
export function memberRemovalVerdict(input: {
  actorRole: MembershipRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: MembershipRole;
  ownerCount: number;
}): MemberChangeVerdict {
  if (!canManageMembers(input.actorRole)) {
    return { ok: false, reason: 'Seuls le propriétaire et la direction retirent des membres.' };
  }
  if (input.actorUserId === input.targetUserId) {
    return { ok: false, reason: 'Vous ne pouvez pas vous retirer vous-même — un autre responsable doit le faire.' };
  }
  if (input.targetRole === 'owner' && input.actorRole !== 'owner') {
    return { ok: false, reason: 'Seul un propriétaire peut retirer un autre propriétaire.' };
  }
  if (input.targetRole === 'owner' && input.ownerCount <= 1) {
    return { ok: false, reason: 'Nommez d’abord un autre propriétaire : l’organisation ne peut pas rester sans propriétaire.' };
  }
  return { ok: true };
}

/**
 * Matrice de permissions par module (écran 14). Elle reflète les règles
 * ci-dessus et celles des modules ; elle sert à l'affichage et aux tests,
 * le serveur reste seul décideur à chaque action.
 */
export type ModulePermission = 'gestion' | 'constat' | 'lecture' | 'aucun';

export const PERMISSION_MODULES = [
  { key: 'referentiels', label: 'Référentiels, contrôles & évaluations' },
  { key: 'risques', label: 'Risques & EBIOS RM' },
  { key: 'plan_action', label: 'Plan d’action' },
  { key: 'documents', label: 'Documents & preuves' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'audits', label: 'Audits internes' },
  { key: 'revue_direction', label: 'Revue de direction' },
  { key: 'qualite', label: 'Processus & non-conformités' },
  { key: 'organisation', label: 'Organisation & périmètres' },
  { key: 'membres', label: 'Membres & rôles' },
  { key: 'journal', label: 'Journal d’audit' },
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number]['key'];

export function modulePermission(role: MembershipRole, module: PermissionModule): ModulePermission {
  switch (module) {
    case 'membres':
      return canManageMembers(role) ? 'gestion' : 'lecture';
    case 'organisation':
      return ['owner', 'direction', 'rssi', 'resp_qualite'].includes(role) ? 'gestion' : 'lecture';
    case 'journal':
      return 'lecture';
    case 'audits':
      // Séparation des tâches : l'auditeur rédige ses constats mais ne
      // modifie jamais les contrôles, risques ou documents qu'il audite.
      if (role === 'auditeur') return 'constat';
      return canManageControls(role) ? 'gestion' : 'lecture';
    case 'revue_direction':
      return ['owner', 'direction', 'rssi', 'resp_qualite'].includes(role) ? 'gestion' : 'lecture';
    default:
      return canManageControls(role) ? 'gestion' : 'lecture';
  }
}

/**
 * Verdict d'accès au contexte tenant pour une session donnée.
 * `totp_requis` signifie : membre légitime, mais l'accès reste bloqué
 * tant que la double authentification n'est pas activée.
 */
export type TenantAccessVerdict = 'autorise' | 'totp_requis' | 'refuse';

export function tenantAccessVerdict(input: {
  membershipRole: MembershipRole | null;
  twoFactorEnabled: boolean;
}): TenantAccessVerdict {
  if (input.membershipRole === null) return 'refuse';
  if (totpRequiredForRole(input.membershipRole) && !input.twoFactorEnabled) {
    return 'totp_requis';
  }
  return 'autorise';
}
