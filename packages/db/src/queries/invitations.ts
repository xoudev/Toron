import { createHash, randomBytes } from 'node:crypto';

import {
  invitationAcceptanceVerdict, invitationExpiry, invitationState, maskEmail, normalizeEmail,
  type InvitationState, type MembershipRole,
} from '@toron/core';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { writeAuditEntry } from '../audit.ts';
import type { Db } from '../client.ts';
import * as schema from '../schema/index.ts';
import { withTenant, type TenantTx } from '../tenant.ts';

// ── Invitations de membres (module 5.1) ─────────────────────────────────
// Le jeton circule dans le lien ; la base ne conserve que son empreinte.

export interface InvitationRow {
  id: string; email: string; role: MembershipRole; invitedByName: string | null;
  expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null; createdAt: Date;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Jeton URL-safe de 32 octets aléatoires. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function listInvitations(tx: TenantTx): Promise<InvitationRow[]> {
  const rows = await tx.select({
    id: schema.invitations.id, email: schema.invitations.email, role: schema.invitations.role,
    invitedByName: schema.users.name, expiresAt: schema.invitations.expiresAt,
    acceptedAt: schema.invitations.acceptedAt, revokedAt: schema.invitations.revokedAt,
    createdAt: schema.invitations.createdAt,
  }).from(schema.invitations)
    .leftJoin(schema.users, eq(schema.users.id, schema.invitations.invitedBy))
    .orderBy(desc(schema.invitations.createdAt));
  return rows.map((r) => ({ ...r, role: r.role as MembershipRole }));
}

/**
 * Crée l'invitation et renvoie le jeton en clair, à transmettre une seule
 * fois. Une invitation en attente pour la même adresse est remplacée.
 */
export async function createInvitation(tx: TenantTx, input: {
  tenantId: string; email: string; role: MembershipRole; invitedBy: string; now?: Date;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  await tx.update(schema.invitations).set({ revokedAt: now })
    .where(and(eq(schema.invitations.email, email), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)));
  const token = generateInvitationToken();
  const expiresAt = invitationExpiry(now);
  const [row] = await tx.insert(schema.invitations).values({
    tenantId: input.tenantId, email, role: input.role, tokenHash: hashInvitationToken(token),
    invitedBy: input.invitedBy, expiresAt,
  }).returning({ id: schema.invitations.id });
  return { id: row!.id, token, expiresAt };
}

export async function revokeInvitation(tx: TenantTx, id: string, now = new Date()): Promise<boolean> {
  const rows = await tx.update(schema.invitations).set({ revokedAt: now })
    .where(and(eq(schema.invitations.id, id), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)))
    .returning({ id: schema.invitations.id });
  return rows.length > 0;
}

/** Une adresse déjà membre n'a pas besoin d'invitation. */
export async function isEmailMember(tx: TenantTx, email: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE lower(u.email) = ${normalizeEmail(email)} LIMIT 1
  `);
  return (rows as unknown as unknown[]).length > 0;
}

// ── Côté identité (rôle toron_auth, hors contexte tenant) ───────────────

export interface PendingInvitation {
  id: string; tenantId: string; tenantName: string; tenantSlug: string; role: MembershipRole;
  email: string; expiresAt: Date;
}

/** Invitations en attente adressées à la session courante (page « Vos organisations »). */
export async function listPendingInvitationsForEmail(db: Db, email: string, now = new Date()): Promise<PendingInvitation[]> {
  const rows = await db.select({
    id: schema.invitations.id, tenantId: schema.invitations.tenantId, tenantName: schema.tenants.name,
    tenantSlug: schema.tenants.slug, role: schema.invitations.role, email: schema.invitations.email,
    expiresAt: schema.invitations.expiresAt,
  }).from(schema.invitations)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.invitations.tenantId))
    .where(and(
      eq(schema.invitations.email, normalizeEmail(email)),
      isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt),
      gt(schema.invitations.expiresAt, now),
    ))
    .orderBy(desc(schema.invitations.createdAt));
  return rows.map((r) => ({ ...r, role: r.role as MembershipRole }));
}

export interface InvitationPreview {
  tenantName: string; role: MembershipRole; maskedEmail: string; state: InvitationState;
}

/**
 * Aperçu d'une invitation pour la personne qui détient le lien (jeton secret
 * de 256 bits) : organisation, rôle proposé, adresse attendue masquée.
 * Aucune écriture ; un jeton inconnu renvoie null.
 */
export async function previewInvitation(db: Db, token: string, now = new Date()): Promise<InvitationPreview | null> {
  const [row] = await db.select({
    tenantName: schema.tenants.name, role: schema.invitations.role, email: schema.invitations.email,
    expiresAt: schema.invitations.expiresAt, acceptedAt: schema.invitations.acceptedAt, revokedAt: schema.invitations.revokedAt,
  }).from(schema.invitations)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.invitations.tenantId))
    .where(eq(schema.invitations.tokenHash, hashInvitationToken(token)));
  if (!row) return null;
  return {
    tenantName: row.tenantName, role: row.role as MembershipRole, maskedEmail: maskEmail(row.email),
    state: invitationState(row, now),
  };
}

export type AcceptInvitationResult =
  | { ok: true; tenantSlug: string; tenantName: string; role: MembershipRole; alreadyMember: boolean }
  | { ok: false; reason: string };

/**
 * Accepte une invitation sous le rôle d'identité : l'appartenance, le
 * marquage de l'invitation et la trace d'audit partagent la transaction.
 * Un lien invalide ou destiné à une autre adresse est refusé avec sa cause.
 */
export async function acceptInvitation(db: Db, input: {
  token?: string; invitationId?: string; userId: string; sessionEmail: string; now?: Date;
}): Promise<AcceptInvitationResult> {
  const now = input.now ?? new Date();
  const where = input.token
    ? eq(schema.invitations.tokenHash, hashInvitationToken(input.token))
    : input.invitationId ? eq(schema.invitations.id, input.invitationId) : null;
  if (!where) return { ok: false, reason: 'Lien d’invitation incomplet — ouvrez le lien tel qu’il vous a été transmis.' };

  const [inv] = await db.select({
    id: schema.invitations.id, tenantId: schema.invitations.tenantId, email: schema.invitations.email,
    role: schema.invitations.role, expiresAt: schema.invitations.expiresAt,
    acceptedAt: schema.invitations.acceptedAt, revokedAt: schema.invitations.revokedAt,
    tenantName: schema.tenants.name, tenantSlug: schema.tenants.slug,
  }).from(schema.invitations)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.invitations.tenantId))
    .where(where);
  if (!inv) return { ok: false, reason: 'Invitation introuvable — le lien est incomplet ou a été remplacé par un nouveau.' };

  // Les invitations ouvertes par identifiant (depuis la page des
  // organisations) exigent la correspondance d'adresse comme les liens.
  const verdict = invitationAcceptanceVerdict({ invitation: inv, sessionEmail: input.sessionEmail, now });
  if (!verdict.ok) return verdict;

  const role = inv.role as MembershipRole;
  return withTenant(db, inv.tenantId, async (tx) => {
    const existing = await tx.select({ id: schema.memberships.id }).from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, inv.tenantId), eq(schema.memberships.userId, input.userId)));
    const alreadyMember = existing.length > 0;
    if (!alreadyMember) {
      await tx.insert(schema.memberships).values({ tenantId: inv.tenantId, userId: input.userId, role });
    }
    await tx.update(schema.invitations).set({ acceptedAt: now, acceptedBy: input.userId })
      .where(eq(schema.invitations.id, inv.id));
    await writeAuditEntry(tx, {
      tenantId: inv.tenantId, actorUserId: input.userId, action: 'membership.accept_invitation',
      objectType: 'membership', objectId: input.userId, after: { role, invitationId: inv.id, alreadyMember },
    });
    return { ok: true, tenantSlug: inv.tenantSlug, tenantName: inv.tenantName, role, alreadyMember };
  });
}
