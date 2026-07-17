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
