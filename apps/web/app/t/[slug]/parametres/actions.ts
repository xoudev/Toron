'use server';

import {
  MEMBERSHIP_ROLES, SCOPE_KINDS, appError, assignableRoles, auditChainVerdict, canConfigureOrganisation, canManageMembers,
  memberRemovalVerdict, memberRoleChangeVerdict, normalizeEmail, OPTIONAL_MODULES, type AuditChainVerdict,
} from '@toron/core';
import {
  countOwners, createInvitation, deleteLegalEntity, deleteOrganisationScope, deleteSite, getMembership,
  getOrganisationProfile, isEmailMember, removeMember, revokeInvitation, saveLegalEntity, saveOrganisationScope,
  saveSite, setDisabledModules, updateMemberRole, updateOrganisationProfile, verifyAuditChain, withTenant, writeAuditEntry,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { env } from '@/lib/env';

export type { ActionResult };

const CONFIG_REFUSAL = 'La configuration de l’organisation est réservée au propriétaire, à la direction, au RSSI et au responsable qualité.';
const MEMBER_REFUSAL = 'La gestion des membres est réservée au propriétaire et à la direction.';

const Uuid = z.uuid();
const Name = z.string().trim().min(2, 'Nom trop court — 2 caractères minimum.').max(160, 'Nom trop long — 160 caractères maximum.');
const Siren = z.string().trim().transform((v) => v.replace(/\s+/g, '')).pipe(z.string().regex(/^(\d{9})?$/, 'SIREN invalide — 9 chiffres attendus.'));

function invalid(message: string): ActionResult<never> {
  return { ok: false, error: appError('SAISIE_INVALIDE', message) };
}
function firstIssue(err: z.ZodError, fallback: string): string {
  return err.issues[0]?.message ?? fallback;
}
function revalidateTenant(slug: string): void {
  // Le sous-titre d'organisation vit dans le layout : on revalide l'arborescence.
  revalidatePath(`/t/${slug}`, 'layout');
}

// ── Organisation ────────────────────────────────────────────────────────

const ProfileSchema = z.object({
  name: Name,
  sector: z.string().trim().max(120, 'Secteur trop long — 120 caractères maximum.').transform((v) => v || null),
  employeeCount: z.union([z.literal(''), z.coerce.number().int().min(0).max(100_000_000)])
    .transform((v) => (v === '' ? null : v)),
});

export async function updateOrganisationAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRole(slug, canConfigureOrganisation, CONFIG_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) return invalid(firstIssue(parsed.error, 'Profil invalide — vérifiez le nom et l’effectif.'));
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const before = await getOrganisationProfile(tx);
      await updateOrganisationProfile(tx, { name: d.name, employeeCount: d.employeeCount, sector: d.sector });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'organisation.update', objectType: 'organisation',
        objectId: auth.tenantId, before: { name: before.name, employeeCount: before.employeeCount, sector: before.sector },
        after: { name: d.name, employeeCount: d.employeeCount, sector: d.sector }, ip: auth.ip, userAgent: auth.userAgent,
      });
    });
    revalidateTenant(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'L’enregistrement du profil a échoué — réessayez.')) };
  }
}

const EntitySchema = z.object({ id: Uuid.optional(), name: Name, siren: Siren });

export async function saveEntityAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeRole(slug, canConfigureOrganisation, CONFIG_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = EntitySchema.safeParse(input);
  if (!parsed.success) return invalid(firstIssue(parsed.error, 'Entité invalide.'));
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const entityId = await saveLegalEntity(tx, { tenantId: auth.tenantId, id: d.id, name: d.name, siren: d.siren || null });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: d.id ? 'entity.update' : 'entity.create',
        objectType: 'legal_entity', objectId: entityId, after: { name: d.name, siren: d.siren || null }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return entityId;
    });
    revalidateTenant(slug);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ENREGISTREMENT', 'L’enregistrement de l’entité a échoué — réessayez.')) };
  }
}

export async function deleteEntityAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRole(slug, canConfigureOrganisation, CONFIG_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ id: Uuid }).safeParse(input);
  if (!parsed.success) return invalid('Entité invalide — rechargez la page.');
  try {
    const outcome = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const result = await deleteLegalEntity(tx, parsed.data.id);
      if (result === 'supprimee') {
        await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'entity.delete', objectType: 'legal_entity', objectId: parsed.data.id, ip: auth.ip, userAgent: auth.userAgent });
      }
      return result;
    });
    if (outcome === 'sites_rattaches') return { ok: false, error: appError('ENTITE_UTILISEE', 'Cette entité porte encore des sites — supprimez ou rattachez ses sites avant de la retirer.') };
    if (outcome === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Cette entité n’existe plus — rechargez la page.') };
    revalidateTenant(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression de l’entité a échoué — réessayez.')) };
  }
}

const SiteSchema = z.object({
  id: Uuid.optional(), entityId: Uuid, name: Name,
  address: z.string().trim().max(300, 'Adresse trop longue — 300 caractères maximum.').transform((v) => v || null),
});

export async function saveSiteAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeRole(slug, canConfigureOrganisation, CONFIG_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SiteSchema.safeParse(input);
  if (!parsed.success) return invalid(firstIssue(parsed.error, 'Site invalide — choisissez une entité et nommez le site.'));
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const siteId = await saveSite(tx, { tenantId: auth.tenantId, id: d.id, entityId: d.entityId, name: d.name, address: d.address });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: d.id ? 'site.update' : 'site.create', objectType: 'site',
        objectId: siteId, after: { name: d.name, entityId: d.entityId }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return siteId;
    });
    revalidateTenant(slug);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ENREGISTREMENT', 'L’enregistrement du site a échoué — vérifiez l’entité choisie puis réessayez.')) };
  }
}

export async function deleteSiteAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRole(slug, canConfigureOrganisation, CONFIG_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ id: Uuid }).safeParse(input);
  if (!parsed.success) return invalid('Site invalide — rechargez la page.');
  try {
    const deleted = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ok = await deleteSite(tx, parsed.data.id);
      if (ok) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'site.delete', objectType: 'site', objectId: parsed.data.id, ip: auth.ip, userAgent: auth.userAgent });
      return ok;
    });
    if (!deleted) return { ok: false, error: appError('INTROUVABLE', 'Ce site n’existe plus — rechargez la page.') };
    revalidateTenant(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression du site a échoué — réessayez.')) };
  }
}

// ── Périmètres ──────────────────────────────────────────────────────────

const ScopeSchema = z.object({
  id: Uuid.optional(), name: Name, kind: z.enum(SCOPE_KINDS, { error: 'Choisissez la nature du périmètre.' }),
  entityIds: z.array(Uuid).max(100).default([]), siteIds: z.array(Uuid).max(500).default([]),
});

export async function saveScopeAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeRole(slug, canConfigureOrganisation, CONFIG_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ScopeSchema.safeParse(input);
  if (!parsed.success) return invalid(firstIssue(parsed.error, 'Périmètre invalide.'));
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const scopeId = await saveOrganisationScope(tx, { tenantId: auth.tenantId, id: d.id, name: d.name, kind: d.kind, entityIds: d.entityIds, siteIds: d.siteIds });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: d.id ? 'scope.update' : 'scope.create', objectType: 'scope',
        objectId: scopeId, after: { name: d.name, kind: d.kind, entities: d.entityIds.length, sites: d.siteIds.length }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return scopeId;
    });
    revalidateTenant(slug);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ENREGISTREMENT', 'L’enregistrement du périmètre a échoué — réessayez.')) };
  }
}

export async function deleteScopeAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRole(slug, canConfigureOrganisation, CONFIG_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ id: Uuid }).safeParse(input);
  if (!parsed.success) return invalid('Périmètre invalide — rechargez la page.');
  try {
    const result = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const r = await deleteOrganisationScope(tx, parsed.data.id);
      if (r.outcome === 'supprime') {
        await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'scope.delete', objectType: 'scope', objectId: parsed.data.id, ip: auth.ip, userAgent: auth.userAgent });
      }
      return r;
    });
    if (result.outcome === 'utilise') {
      return { ok: false, error: appError('PERIMETRE_UTILISE', `Ce périmètre porte encore ${result.references.join(', ')} — déplacez ou supprimez ces objets avant de le retirer.`) };
    }
    if (result.outcome === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Ce périmètre n’existe plus — rechargez la page.') };
    revalidateTenant(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression du périmètre a échoué — réessayez.')) };
  }
}

// ── Membres & invitations ───────────────────────────────────────────────

const InviteSchema = z.object({
  email: z.email('Adresse e-mail invalide — vérifiez la saisie.').max(254),
  role: z.enum(MEMBERSHIP_ROLES, { error: 'Choisissez un rôle.' }),
});

export async function inviteMemberAction(slug: string, input: unknown): Promise<ActionResult<{ link: string; expiresAt: string; email: string }>> {
  const auth = await authorizeRole(slug, canManageMembers, MEMBER_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) return invalid(firstIssue(parsed.error, 'Invitation invalide.'));
  const d = parsed.data;
  if (d.role === 'owner') return invalid('Le rôle de propriétaire s’attribue à un membre existant, jamais par invitation.');
  if (!assignableRoles(auth.role).includes(d.role)) return { ok: false, error: appError('ROLE_INSUFFISANT', 'Ce rôle dépasse vos droits d’attribution.') };
  const email = normalizeEmail(d.email);
  try {
    const created = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (await isEmailMember(tx, email)) return null;
      const inv = await createInvitation(tx, { tenantId: auth.tenantId, email, role: d.role, invitedBy: auth.userId });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'invitation.create', objectType: 'invitation',
        objectId: inv.id, after: { role: d.role, expiresAt: inv.expiresAt }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return inv;
    });
    if (!created) return { ok: false, error: appError('DEJA_MEMBRE', 'Cette adresse appartient déjà à un membre de l’organisation — modifiez son rôle dans la liste.') };
    revalidatePath(`/t/${slug}/parametres`);
    const base = env().BETTER_AUTH_URL.replace(/\/$/, '');
    return { ok: true, data: { link: `${base}/invitations/${created.token}`, expiresAt: created.expiresAt.toISOString(), email } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_INVITATION', 'L’invitation n’a pas pu être créée — réessayez.')) };
  }
}

export async function revokeInvitationAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRole(slug, canManageMembers, MEMBER_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ id: Uuid }).safeParse(input);
  if (!parsed.success) return invalid('Invitation invalide — rechargez la page.');
  try {
    const revoked = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ok = await revokeInvitation(tx, parsed.data.id);
      if (ok) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'invitation.revoke', objectType: 'invitation', objectId: parsed.data.id, ip: auth.ip, userAgent: auth.userAgent });
      return ok;
    });
    if (!revoked) return { ok: false, error: appError('INTROUVABLE', 'Cette invitation n’est plus en attente — rechargez la page.') };
    revalidatePath(`/t/${slug}/parametres`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_REVOCATION', 'La révocation a échoué — réessayez.')) };
  }
}

export async function changeMemberRoleAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRole(slug, canManageMembers, MEMBER_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ userId: Uuid, role: z.enum(MEMBERSHIP_ROLES) }).safeParse(input);
  if (!parsed.success) return invalid('Changement de rôle invalide — rechargez la page.');
  const d = parsed.data;
  try {
    const outcome = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const target = await getMembership(tx, d.userId);
      if (!target) return { ok: false as const, reason: 'Ce membre ne fait plus partie de l’organisation — rechargez la page.' };
      const verdict = memberRoleChangeVerdict({
        actorRole: auth.role, actorUserId: auth.userId, targetUserId: d.userId, targetRole: target.role,
        newRole: d.role, ownerCount: await countOwners(tx),
      });
      if (!verdict.ok) return verdict;
      if (target.role !== d.role) {
        await updateMemberRole(tx, { tenantId: auth.tenantId, userId: d.userId, role: d.role });
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'membership.change_role', objectType: 'membership',
          objectId: d.userId, before: { role: target.role }, after: { role: d.role }, ip: auth.ip, userAgent: auth.userAgent,
        });
      }
      return { ok: true as const };
    });
    if (!outcome.ok) return { ok: false, error: appError('CHANGEMENT_REFUSE', outcome.reason) };
    revalidatePath(`/t/${slug}/parametres`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'Le changement de rôle a échoué — réessayez.')) };
  }
}

export async function removeMemberAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRole(slug, canManageMembers, MEMBER_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ userId: Uuid }).safeParse(input);
  if (!parsed.success) return invalid('Membre invalide — rechargez la page.');
  const d = parsed.data;
  try {
    const outcome = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const target = await getMembership(tx, d.userId);
      if (!target) return { ok: false as const, reason: 'Ce membre ne fait plus partie de l’organisation — rechargez la page.' };
      const verdict = memberRemovalVerdict({
        actorRole: auth.role, actorUserId: auth.userId, targetUserId: d.userId, targetRole: target.role, ownerCount: await countOwners(tx),
      });
      if (!verdict.ok) return verdict;
      await removeMember(tx, { tenantId: auth.tenantId, userId: d.userId });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'membership.remove', objectType: 'membership',
        objectId: d.userId, before: { role: target.role }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return { ok: true as const };
    });
    if (!outcome.ok) return { ok: false, error: appError('RETRAIT_REFUSE', outcome.reason) };
    revalidatePath(`/t/${slug}/parametres`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_RETRAIT', 'Le retrait du membre a échoué — réessayez.')) };
  }
}

// ── Modules ─────────────────────────────────────────────────────────────

export async function setModulesAction(slug: string, input: unknown): Promise<ActionResult<{ disabled: string[] }>> {
  const auth = await authorizeRole(slug, canConfigureOrganisation, CONFIG_REFUSAL);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ disabled: z.array(z.enum(OPTIONAL_MODULES)).max(OPTIONAL_MODULES.length) }).safeParse(input);
  if (!parsed.success) return invalid('Sélection de modules invalide — rechargez la page.');
  try {
    const disabled = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const before = (await getOrganisationProfile(tx)).disabledModules;
      const saved = await setDisabledModules(tx, parsed.data.disabled);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'organisation.modules', objectType: 'organisation',
        objectId: auth.tenantId, before: { disabled: before }, after: { disabled: saved }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return saved;
    });
    revalidateTenant(slug);
    return { ok: true, data: { disabled } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'Les modules n’ont pas été enregistrés — réessayez.')) };
  }
}

// ── Journal d'audit ─────────────────────────────────────────────────────

export interface JournalCheck extends AuditChainVerdict {
  entries: number;
  headSeq: number;
  headHash: string | null;
  checkedAt: string;
}

/**
 * Vérification du chaînage, ouverte à tout membre (l'auditeur en premier) :
 * lecture seule, recalcul fait par la base. La vérification elle-même est
 * inscrite au journal, avec son résultat.
 */
export async function verifyJournalAction(slug: string): Promise<ActionResult<JournalCheck>> {
  const auth = await authorizeRole(slug, () => true, 'La vérification du journal est réservée aux membres de l’organisation.');
  if (isActionError(auth)) return { ok: false, error: auth };
  try {
    const status = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const s = await verifyAuditChain(tx);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'journal.verify', objectType: 'journal',
        objectId: auth.tenantId,
        after: { entries: s.entries, lastSeq: s.lastSeq, headSeq: s.headSeq, intact: s.intact, brokenAtSeq: s.brokenAtSeq },
        ip: auth.ip, userAgent: auth.userAgent,
      });
      return s;
    });
    return {
      ok: true,
      data: {
        ...auditChainVerdict(status),
        entries: status.entries, headSeq: status.headSeq, headHash: status.headHash, checkedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_VERIFICATION', 'La vérification du journal n’a pas abouti — réessayez dans un instant.')) };
  }
}
