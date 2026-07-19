'use server';

import { appError } from '@toron/core';
import {
  closeNc,
  confirmEffective,
  createAction,
  createNc,
  getNc,
  reopenNc,
  updateNcSteps,
  withTenant,
  writeAuditEntry,
  type NcDetail,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  authorizeManager,
  isActionError,
  logFailure,
  type ActionResult,
} from '@/lib/action-guard';
import { appDb } from '@/lib/db';

export type { ActionResult };

const Source = z.enum(['interne', 'fournisseur', 'reclamation_client']);
const Gravity = z.enum(['mineure', 'majeure', 'critique']);

export async function createNcAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(4000).optional().nullable(),
    source: Source,
    gravity: Gravity,
    processRef: z.string().trim().max(200).optional().nullable(),
    costEstimate: z.number().nonnegative().max(1e9).optional().nullable(),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Non-conformité invalide — un intitulé, une source et une gravité sont requis.') };
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const nid = await createNc(tx, { tenantId: auth.tenantId, title: d.title, description: d.description ?? null, source: d.source, gravity: d.gravity, processRef: d.processRef ?? null, costEstimate: d.costEstimate ?? null, detectedBy: auth.userId, ownerUserId: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'nc.create', objectType: 'nonconformity', objectId: nid, after: { title: d.title, source: d.source }, ip: auth.ip, userAgent: auth.userAgent });
      return nid;
    });
    revalidatePath(`/t/${slug}/non-conformites`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La déclaration de la NC a échoué — réessayez.')) };
  }
}

export async function updateNcAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({
    ncId: z.uuid(),
    immediateAction: z.string().trim().max(4000).optional().nullable(),
    whys: z.array(z.string().trim().max(600)).max(10).optional(),
    rootCauseText: z.string().trim().max(1000).optional().nullable(),
    problem: z.string().trim().max(600).optional().nullable(),
    gravity: Gravity.optional(),
    costEstimate: z.number().nonnegative().max(1e9).optional().nullable(),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Modifications invalides.') };
  const d = parsed.data;
  const rootCause =
    d.whys !== undefined || d.rootCauseText !== undefined || d.problem !== undefined
      ? { probleme: d.problem ?? '', pourquoi: (d.whys ?? []).filter((w) => w.length > 0), cause_racine: d.rootCauseText ?? '' }
      : undefined;
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await updateNcSteps(tx, { ncId: d.ncId, immediateAction: d.immediateAction, rootCause, gravity: d.gravity, costEstimate: d.costEstimate, status: 'en_traitement' });
      if (affected > 0) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'nc.update', objectType: 'nonconformity', objectId: d.ncId, ip: auth.ip, userAgent: auth.userAgent });
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('INTROUVABLE', 'Cette NC n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/non-conformites`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour a échoué — réessayez.')) };
  }
}

export async function createCorrectiveActionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ ncId: z.uuid(), title: z.string().trim().min(2).max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Action corrective invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const aid = await createAction(tx, { tenantId: auth.tenantId, title: d.title, originType: 'nc', originId: d.ncId, ownerUserId: auth.userId, priority: 'p2' });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'nc.corrective_action', objectType: 'action', objectId: aid, after: { ncId: d.ncId }, ip: auth.ip, userAgent: auth.userAgent });
    });
    revalidatePath(`/t/${slug}/non-conformites`);
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ACTION', 'La création de l’action corrective a échoué — réessayez.')) };
  }
}

const TransitionSchema = z.object({ ncId: z.uuid(), transition: z.enum(['close', 'confirm', 'reopen']) });

export async function transitionNcAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = TransitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Transition invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (d.transition === 'close') await closeNc(tx, d.ncId);
      else if (d.transition === 'confirm') await confirmEffective(tx, d.ncId);
      else await reopenNc(tx, d.ncId);
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `nc.${d.transition}`, objectType: 'nonconformity', objectId: d.ncId, ip: auth.ip, userAgent: auth.userAgent });
    });
    revalidatePath(`/t/${slug}/non-conformites`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_TRANSITION', 'L’opération a échoué — réessayez.')) };
  }
}

export async function getNcAction(slug: string, ncId: string): Promise<ActionResult<NcDetail>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(ncId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const d = await withTenant(appDb().db, auth.tenantId, (tx) => getNc(tx, parsed.data));
    if (!d) return { ok: false, error: appError('INTROUVABLE', 'NC introuvable.') };
    return { ok: true, data: d };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué — réessayez.')) };
  }
}
