'use server';

import {
  NIS2_REGISTRATION_STATES,
  NIS2_SECTOR_KEYS,
  NIS2_STATUSES,
  OBLIGATION_REGIMES,
  OBLIGATION_STATUSES,
  appError,
  canConfigureOrganisation,
  nis2Qualification,
  obligationJustificationRequired,
  suggestedObligations,
} from '@toron/core';
import {
  addCatalogObligations,
  createObligation,
  deleteObligation,
  listEntitiesNis2,
  updateEntityNis2,
  updateObligation,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeManager, authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

export type { ActionResult };

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

const authorizeConfigurer = (slug: string) => authorizeRole(
  slug,
  canConfigureOrganisation,
  'Seuls la direction, le RSSI et le responsable qualité qualifient les entités de l’organisation.',
);

const EntitySchema = z.object({
  entityId: z.uuid(),
  sector: z.enum(NIS2_SECTOR_KEYS).nullable(),
  employees: z.number().int().min(0).max(10_000_000).nullable(),
  turnoverMeur: z.number().min(0).max(1_000_000).nullable(),
  balanceSheetMeur: z.number().min(0).max(1_000_000).nullable(),
  override: z.enum(NIS2_STATUSES).nullable(),
  overrideReason: optionalText(1000),
  registration: z.enum(NIS2_REGISTRATION_STATES),
  registeredOn: Day.nullable(),
  reference: optionalText(120),
});

export async function updateEntityNis2Action(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeConfigurer(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = EntitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Qualification invalide — vérifiez l’effectif, le chiffre d’affaires et le bilan (nombres positifs).') };
  const d = parsed.data;
  if (d.override && !d.overrideReason) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Indiquez pourquoi la qualification retenue diffère du calcul (désignation, cas particulier).') };
  }
  if (d.registeredOn && d.registeredOn > todayParis()) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'La date d’enregistrement ne peut pas être dans le futur.') };
  }
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await updateEntityNis2(tx, d);
      if (affected > 0) {
        const q = nis2Qualification({ sector: d.sector, employees: d.employees, turnoverMeur: d.turnoverMeur, balanceSheetMeur: d.balanceSheetMeur, override: d.override });
        await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'entity.nis2', objectType: 'legal_entity', objectId: d.entityId, after: { qualification: q.status, overridden: q.overridden, registration: d.registration }, ip: auth.ip, userAgent: auth.userAgent });
      }
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('INTROUVABLE', 'Cette entité n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/obligations`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'L’enregistrement de la qualification a échoué — réessayez.')) };
  }
}

export async function addSuggestedObligationsAction(slug: string, entityId: string): Promise<ActionResult<{ added: number }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(entityId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const added = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const entity = (await listEntitiesNis2(tx)).find((e) => e.id === parsed.data);
      if (!entity) return null;
      const q = nis2Qualification({ ...entity, override: entity.override });
      const count = await addCatalogObligations(tx, { tenantId: auth.tenantId, entityId: entity.id, ownerUserId: auth.userId, templates: suggestedObligations(q.status) });
      if (count > 0) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'obligation.suggestions', objectType: 'legal_entity', objectId: entity.id, after: { added: count, qualification: q.status }, ip: auth.ip, userAgent: auth.userAgent });
      return count;
    });
    if (added === null) return { ok: false, error: appError('INTROUVABLE', 'Cette entité n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/obligations`);
    return { ok: true, data: { added } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’ajout des obligations suggérées a échoué — réessayez.')) };
  }
}

const ObligationSchema = z.object({
  entityId: z.uuid().nullable(),
  regime: z.enum(OBLIGATION_REGIMES),
  title: z.string().trim().min(2).max(300),
  source: optionalText(300),
  description: optionalText(4000),
  ownerUserId: z.uuid().nullable(),
  status: z.enum(OBLIGATION_STATUSES),
  justification: optionalText(2000),
  dueDate: Day.nullable(),
});

function checkJustification(d: z.infer<typeof ObligationSchema>) {
  return obligationJustificationRequired(d.status) && !d.justification
    ? appError('SAISIE_INVALIDE', 'Expliquez pourquoi l’obligation ne s’applique pas : c’est ce que demandera un contrôleur.')
    : null;
}

export async function createObligationAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ObligationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Obligation invalide — un intitulé et un régime sont requis.') };
  const missing = checkJustification(parsed.data);
  if (missing) return { ok: false, error: missing };
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const oid = await createObligation(tx, auth.tenantId, parsed.data);
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'obligation.create', objectType: 'obligation', objectId: oid, after: { regime: parsed.data.regime, status: parsed.data.status }, ip: auth.ip, userAgent: auth.userAgent });
      return oid;
    });
    revalidatePath(`/t/${slug}/obligations`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création de l’obligation a échoué — vérifiez l’entité choisie, puis réessayez.')) };
  }
}

export async function updateObligationAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ObligationSchema.extend({ obligationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Modifications invalides — un intitulé et un régime sont requis.') };
  const { obligationId, ...d } = parsed.data;
  const missing = checkJustification(d);
  if (missing) return { ok: false, error: missing };
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await updateObligation(tx, obligationId, d);
      if (affected > 0) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'obligation.update', objectType: 'obligation', objectId: obligationId, after: { status: d.status, dueDate: d.dueDate }, ip: auth.ip, userAgent: auth.userAgent });
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('INTROUVABLE', 'Cette obligation n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/obligations`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour a échoué — réessayez.')) };
  }
}

export async function deleteObligationAction(slug: string, obligationId: string): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(obligationId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const removed = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const r = await deleteObligation(tx, parsed.data);
      if (r) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'obligation.delete', objectType: 'obligation', objectId: parsed.data, before: { title: r.title }, ip: auth.ip, userAgent: auth.userAgent });
      return r;
    });
    if (!removed) return { ok: false, error: appError('INTROUVABLE', 'Cette obligation a déjà été supprimée — rechargez la page.') };
    revalidatePath(`/t/${slug}/obligations`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression a échoué — réessayez.')) };
  }
}
