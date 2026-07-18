'use server';

import { appError } from '@toron/core';
import {
  addComment,
  addSubtask,
  bulkSetStatus,
  createAction,
  getActionDetail,
  setActionStatus,
  setSubtaskDone,
  updateActionDetails,
  withTenant,
  writeAuditEntry,
  type ActionDetail,
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

const Origin = z.enum(['risk', 'finding', 'incident', 'nc', 'assessment', 'review', 'manual']);
const Priority = z.enum(['p1', 'p2', 'p3']);
const Status = z.enum(['planifie', 'en_cours', 'termine', 'verification']);
const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
  .optional()
  .nullable();

const CreateSchema = z.object({
  title: z.string().trim().min(2, '2 caractères minimum').max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  originType: Origin.default('manual'),
  originId: z.uuid().optional().nullable(),
  ownerUserId: z.uuid().optional().nullable(),
  dueDate: DateStr,
  priority: Priority.default('p2'),
});

export async function createActionAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ actionId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Action invalide — un intitulé de 2 caractères minimum est requis.') };
  }
  const d = parsed.data;
  try {
    const actionId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createAction(tx, {
        tenantId: auth.tenantId,
        title: d.title,
        description: d.description ?? null,
        originType: d.originType,
        originId: d.originId ?? null,
        ownerUserId: d.ownerUserId ?? null,
        dueDate: d.dueDate ?? null,
        priority: d.priority,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'action.create',
        objectType: 'action',
        objectId: id,
        after: { title: d.title, originType: d.originType },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: { actionId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création de l’action a échoué — réessayez.')) };
  }
}

const UpdateSchema = z.object({
  actionId: z.uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  ownerUserId: z.uuid().optional().nullable(),
  dueDate: DateStr,
  priority: Priority,
});

export async function updateActionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Modifications invalides — vérifiez les champs.') };
  }
  const d = parsed.data;
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await updateActionDetails(tx, {
        actionId: d.actionId,
        title: d.title,
        description: d.description ?? null,
        ownerUserId: d.ownerUserId ?? null,
        dueDate: d.dueDate ?? null,
        priority: d.priority,
      });
      if (affected > 0) {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'action.update',
          objectType: 'action',
          objectId: d.actionId,
          after: { title: d.title },
          ip: auth.ip,
          userAgent: auth.userAgent,
        });
      }
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('ACTION_INTROUVABLE', 'Cette action n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour a échoué — réessayez.')) };
  }
}

const SetStatusSchema = z.object({ actionId: z.uuid(), status: Status });

export async function setActionStatusAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SetStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Statut invalide.') };
  }
  const d = parsed.data;
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await setActionStatus(tx, d.actionId, d.status);
      if (affected > 0) {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'action.status',
          objectType: 'action',
          objectId: d.actionId,
          after: { status: d.status },
          ip: auth.ip,
          userAgent: auth.userAgent,
        });
      }
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('ACTION_INTROUVABLE', 'Cette action n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_STATUT', 'Le changement de statut a échoué — réessayez.')) };
  }
}

const BulkSchema = z.object({
  actionIds: z.array(z.uuid()).min(1).max(200),
  status: Status,
  justification: z.string().trim().min(5, 'Justifiez l’action groupée (5 caractères min).').max(1000),
});

export async function bulkStatusAction(slug: string, input: unknown): Promise<ActionResult<{ count: number }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = BulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Action groupée invalide — sélection et justification (5 caractères min) requises.') };
  }
  const d = parsed.data;
  try {
    const count = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const n = await bulkSetStatus(tx, d.actionIds, d.status);
      // La justification est tracée dans l'audit (pas de mutation silencieuse).
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'action.bulk_status',
        objectType: 'action',
        after: { status: d.status, count: n, justification: d.justification, ids: d.actionIds },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return n;
    });
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: { count } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_GROUPE', 'L’action groupée a échoué — réessayez.')) };
  }
}

const SubtaskAddSchema = z.object({ actionId: z.uuid(), title: z.string().trim().min(1).max(300) });

export async function addSubtaskAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SubtaskAddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Sous-tâche invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) =>
      addSubtask(tx, { tenantId: auth.tenantId, actionId: d.actionId, title: d.title }),
    );
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SOUS_TACHE', 'L’ajout de la sous-tâche a échoué — réessayez.')) };
  }
}

const SubtaskToggleSchema = z.object({ subtaskId: z.uuid(), done: z.boolean() });

export async function toggleSubtaskAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SubtaskToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Sous-tâche invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => setSubtaskDone(tx, d.subtaskId, d.done));
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SOUS_TACHE', 'La mise à jour de la sous-tâche a échoué — réessayez.')) };
  }
}

const CommentSchema = z.object({ actionId: z.uuid(), body: z.string().trim().min(1).max(4000) });

export async function addCommentAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = CommentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Commentaire vide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) =>
      addComment(tx, { tenantId: auth.tenantId, actionId: d.actionId, authorUserId: auth.userId, body: d.body }),
    );
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_COMMENTAIRE', 'L’ajout du commentaire a échoué — réessayez.')) };
  }
}

export async function getActionDetailAction(
  slug: string,
  actionId: string,
): Promise<ActionResult<ActionDetail>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(actionId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence d’action invalide.') };
  try {
    const detail = await withTenant(appDb().db, auth.tenantId, (tx) => getActionDetail(tx, parsed.data));
    return { ok: true, data: detail };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture de l’action a échoué — réessayez.')) };
  }
}
