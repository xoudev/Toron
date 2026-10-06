import type { MembershipRole } from './authz.ts';

export const SCOPE_KINDS = ['smsi', 'qms', 'mixte'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const SCOPE_KIND_LABEL: Record<ScopeKind, string> = {
  smsi: 'Sécurité de l’information (SMSI)',
  qms: 'Management de la qualité (QMS)',
  mixte: 'Sécurité et qualité (SMSI + QMS)',
};
export const SCOPE_KIND_SHORT: Record<ScopeKind, string> = {
  smsi: 'SMSI',
  qms: 'QMS',
  mixte: 'SMSI + QMS',
};

/** Configuration métier de l'organisation ; distincte de la gestion des accès. */
export function canConfigureOrganisation(role: MembershipRole): boolean {
  return ['owner', 'direction', 'rssi', 'resp_qualite'].includes(role);
}

export function organisationSummary(input: {
  scopeCount: number; siteCount: number; employeeCount: number | null;
}): string {
  const parts = [
    `${input.scopeCount} périmètre${input.scopeCount > 1 ? 's' : ''}`,
    `${input.siteCount} site${input.siteCount > 1 ? 's' : ''}`,
  ];
  if (input.employeeCount !== null) parts.push(`${input.employeeCount} salarié${input.employeeCount > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/**
 * Étiquette courte du système de management, dérivée des périmètres réels :
 * « SMSI + QMS » dès qu'un périmètre mixte existe ou que les deux natures
 * cohabitent, sinon la nature unique, sinon l'invitation à en créer un.
 */
export function managementSystemLabel(scopeKinds: readonly ScopeKind[]): string {
  if (scopeKinds.length === 0) return 'Aucun périmètre défini';
  const kinds = new Set(scopeKinds);
  if (kinds.has('mixte') || (kinds.has('smsi') && kinds.has('qms'))) return 'Périmètre SMSI + QMS';
  return kinds.has('smsi') ? 'Périmètre SMSI' : 'Périmètre QMS';
}

/** Sous-titre d'organisation affiché dans la navigation et le tableau de bord. */
export function organisationHeadline(input: {
  scopeKinds: readonly ScopeKind[]; siteCount: number; employeeCount: number | null;
}): string {
  const parts = [managementSystemLabel(input.scopeKinds)];
  if (input.employeeCount !== null) parts.push(`${input.employeeCount} salarié${input.employeeCount > 1 ? 's' : ''}`);
  if (input.siteCount > 0) parts.push(`${input.siteCount} site${input.siteCount > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

// ── Invitations ─────────────────────────────────────────────────────────

export const INVITATION_VALIDITY_DAYS = 7;

export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}

export type InvitationState = 'en_attente' | 'acceptee' | 'revoquee' | 'expiree';

export function invitationState(
  inv: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date,
): InvitationState {
  if (inv.acceptedAt) return 'acceptee';
  if (inv.revokedAt) return 'revoquee';
  if (inv.expiresAt.getTime() <= now.getTime()) return 'expiree';
  return 'en_attente';
}

export const INVITATION_STATE_LABEL: Record<InvitationState, string> = {
  en_attente: 'En attente',
  acceptee: 'Acceptée',
  revoquee: 'Révoquée',
  expiree: 'Expirée',
};

/** Adresse normalisée pour la comparaison invitation ↔ session. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Une invitation ne se consomme qu'avec le compte dont l'adresse correspond :
 * un lien transmis à un tiers ne lui ouvre rien.
 */
export function invitationAcceptanceVerdict(input: {
  invitation: { email: string; expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null };
  sessionEmail: string;
  now: Date;
}): { ok: true } | { ok: false; reason: string } {
  const state = invitationState(input.invitation, input.now);
  if (state === 'acceptee') return { ok: false, reason: 'Cette invitation a déjà été utilisée — connectez-vous pour ouvrir l’organisation.' };
  if (state === 'revoquee') return { ok: false, reason: 'Cette invitation a été révoquée — demandez un nouveau lien à l’organisation.' };
  if (state === 'expiree') return { ok: false, reason: 'Cette invitation a expiré — demandez un nouveau lien à l’organisation.' };
  if (normalizeEmail(input.invitation.email) !== normalizeEmail(input.sessionEmail)) {
    return { ok: false, reason: 'Cette invitation est destinée à une autre adresse e-mail — connectez-vous avec le compte invité.' };
  }
  return { ok: true };
}
