'use server';

import {
  CONTROL_REVIEW_METHODS,
  CONTROL_REVIEW_RESULTS,
  REVIEW_FREQUENCIES,
  addDaysIso,
  appError,
  canRecordControlReview,
  controlCorrectiveAction,
  controlReviewError,
  reviewNeedsCorrection,
} from '@toron/core';
import {
  createAction,
  createControlReview,
  getControlDetail,
  getControlRef,
  isTenantMember,
  notifyAssignment,
  updateControl,
  withTenant,
  writeAuditEntry,
  type ControlDetail,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeManager, authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

export type { ActionResult };

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const authorizeReader = (slug: string) => authorizeRole(slug, () => true, 'Accès refusé.');
const authorizeReviewer = (slug: string) => authorizeRole(
  slug,
  canRecordControlReview,
  'Votre rôle est en lecture seule — demandez au responsable du contrôle ou à un auditeur de consigner la revue.',
);

export async function getControlDetailAction(slug: string, controlId: string): Promise<ActionResult<ControlDetail>> {
  const auth = await authorizeReader(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(controlId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de contrôle invalide.') };
  try {
    const detail = await withTenant(appDb().db, auth.tenantId, (tx) => getControlDetail(tx, parsed.data));
    if (!detail) return { ok: false, error: appError('INTROUVABLE', 'Ce contrôle n’existe plus — rechargez la page.') };
    return { ok: true, data: detail };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture du contrôle a échoué — réessayez.')) };
  }
}

const UpdateSchema = z.object({
  controlId: z.uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).nullable().optional().transform((v) => v || null),
  ownerUserId: z.uuid().nullable(),
  reviewFrequency: z.enum(REVIEW_FREQUENCIES).nullable(),
  status: z.enum(['brouillon', 'actif', 'archive']),
});

/** Met à jour la fiche d'un contrôle : intitulé, description, responsable, fréquence de revue, statut. */
export async function updateControlAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Fiche invalide — un intitulé de 2 caractères au moins est requis.') };
  const d = parsed.data;
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getControlRef(tx, d.controlId);
      if (!ref) return 'introuvable' as const;
      if (d.ownerUserId && !(await isTenantMember(tx, d.ownerUserId))) return 'responsable' as const;
      await updateControl(tx, d);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'control.update', objectType: 'control', objectId: d.controlId,
        after: { title: d.title, reviewFrequency: d.reviewFrequency, status: d.status }, ip: auth.ip, userAgent: auth.userAgent,
      });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'controle', objectId: d.controlId, objectTitle: d.title, previousOwnerId: ref.ownerUserId, nextOwnerId: d.ownerUserId });
      return 'ok' as const;
    });
    if (res === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Ce contrôle n’existe plus — rechargez la page.') };
    if (res === 'responsable') return { ok: false, error: appError('RESPONSABLE_INVALIDE', 'Le responsable choisi ne fait plus partie de l’organisation — choisissez-en un autre.') };
    revalidatePath(`/t/${slug}/controles`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour du contrôle a échoué — réessayez.')) };
  }
}

const ReviewSchema = z.object({
  controlId: z.uuid(),
  reviewedOn: Day,
  method: z.enum(CONTROL_REVIEW_METHODS),
  result: z.enum(CONTROL_REVIEW_RESULTS),
  observations: z.string().trim().max(4000).nullable().optional().transform((v) => v || null),
  evidenceId: z.uuid().nullable(),
  openAction: z.boolean(),
});

/**
 * Consigne une revue d'efficacité. Pour un contrôle défaillant, ouvre au
 * besoin l'action corrective, confiée au responsable du contrôle.
 */
export async function recordControlReviewAction(slug: string, input: unknown): Promise<ActionResult<{ reviewId: string; actionId: string | null }>> {
  const auth = await authorizeReviewer(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Revue invalide — date, méthode et résultat sont requis.') };
  const d = parsed.data;
  const today = todayParis();
  const invalid = controlReviewError(d, today);
  if (invalid) return { ok: false, error: appError('REVUE_INVALIDE', invalid) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getControlRef(tx, d.controlId);
      if (!ref) return { kind: 'introuvable' as const };
      if (d.evidenceId) {
        // La preuve citée doit être rattachée au contrôle revu.
        const detail = await getControlDetail(tx, d.controlId);
        if (!detail?.evidences.some((e) => e.id === d.evidenceId)) return { kind: 'preuve' as const };
      }
      const reviewId = await createControlReview(tx, {
        tenantId: auth.tenantId, controlId: d.controlId, reviewedOn: d.reviewedOn, reviewerUserId: auth.userId,
        method: d.method, result: d.result, observations: d.observations, evidenceId: d.evidenceId,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'control.review', objectType: 'control', objectId: d.controlId,
        after: { reviewId, result: d.result, method: d.method, reviewedOn: d.reviewedOn }, ip: auth.ip, userAgent: auth.userAgent,
      });
      let actionId: string | null = null;
      if (d.openAction && reviewNeedsCorrection(d.result)) {
        const corrective = controlCorrectiveAction(ref.title, d.result);
        const owner = ref.ownerUserId && (await isTenantMember(tx, ref.ownerUserId)) ? ref.ownerUserId : auth.userId;
        actionId = await createAction(tx, {
          tenantId: auth.tenantId, title: corrective.title, description: d.observations, originType: 'control', originId: d.controlId,
          ownerUserId: owner, priority: corrective.priority, dueDate: addDaysIso(today, corrective.priority === 'p1' ? 30 : 60),
        });
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'control.corrective_action', objectType: 'action', objectId: actionId,
          after: { controlId: d.controlId, reviewId, priority: corrective.priority }, ip: auth.ip, userAgent: auth.userAgent,
        });
        await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'action', objectId: actionId, objectTitle: corrective.title, previousOwnerId: null, nextOwnerId: owner });
      }
      return { kind: 'ok' as const, reviewId, actionId };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Ce contrôle n’existe plus — rechargez la page.') };
    if (res.kind === 'preuve') return { ok: false, error: appError('PREUVE_INVALIDE', 'Cette preuve n’est pas rattachée au contrôle — choisissez-en une de la liste.') };
    revalidatePath(`/t/${slug}/controles`);
    if (res.actionId) revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: { reviewId: res.reviewId, actionId: res.actionId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_REVUE', 'L’enregistrement de la revue a échoué — réessayez.')) };
  }
}
