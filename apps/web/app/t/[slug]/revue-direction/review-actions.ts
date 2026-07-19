'use server';

import { appError } from '@toron/core';
import {
  addDecision,
  addParticipant,
  convertDecisionToAction,
  createExport,
  createReview,
  getReview,
  listExportsForObject,
  removeParticipant,
  setReviewStatus,
  withTenant,
  writeAuditEntry,
  type ExportSummary,
  type ReviewDetail,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeManager, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';

export type { ActionResult };

const Status = z.enum(['planifie', 'tenue', 'close']);

export async function createReviewAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      title: z.string().trim().min(2).max(200),
      heldAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      nextReviewAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Revue invalide — un intitulé est requis.') };
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const rid = await createReview(tx, { tenantId: auth.tenantId, title: d.title, heldAt: d.heldAt ?? null, nextReviewAt: d.nextReviewAt ?? null });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'review.create', objectType: 'review', objectId: rid, after: { title: d.title }, ip: auth.ip, userAgent: auth.userAgent });
      return rid;
    });
    revalidatePath(`/t/${slug}/revue-direction`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création de la revue a échoué — réessayez.')) };
  }
}

export async function setReviewStatusAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ reviewId: z.uuid(), status: Status }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Statut invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => setReviewStatus(tx, parsed.data.reviewId, parsed.data.status));
    revalidatePath(`/t/${slug}/revue-direction`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_STATUT', 'Le changement de statut a échoué.')) };
  }
}

export async function addDecisionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ reviewId: z.uuid(), body: z.string().trim().min(2).max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Décision invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => addDecision(tx, { tenantId: auth.tenantId, reviewId: parsed.data.reviewId, body: parsed.data.body }));
    revalidatePath(`/t/${slug}/revue-direction`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_DECISION', 'L’ajout de la décision a échoué.')) };
  }
}

export async function convertDecisionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ reviewId: z.uuid(), decisionId: z.uuid(), title: z.string().trim().min(2).max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Conversion invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const aid = await convertDecisionToAction(tx, { tenantId: auth.tenantId, decisionId: d.decisionId, reviewId: d.reviewId, title: d.title, ownerUserId: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'review.decision_to_action', objectType: 'action', objectId: aid, after: { decisionId: d.decisionId }, ip: auth.ip, userAgent: auth.userAgent });
    });
    revalidatePath(`/t/${slug}/revue-direction`);
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CONVERSION', 'La conversion en action a échoué.')) };
  }
}

export async function addParticipantAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ reviewId: z.uuid(), userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Participant invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => addParticipant(tx, { tenantId: auth.tenantId, reviewId: parsed.data.reviewId, userId: parsed.data.userId }));
    revalidatePath(`/t/${slug}/revue-direction`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_PARTICIPANT', 'L’ajout du participant a échoué.')) };
  }
}

export async function removeParticipantAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ reviewId: z.uuid(), userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Participant invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => removeParticipant(tx, parsed.data.reviewId, parsed.data.userId));
    revalidatePath(`/t/${slug}/revue-direction`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_PARTICIPANT', 'Le retrait du participant a échoué.')) };
  }
}

/**
 * Demande le procès-verbal scellé : crée un export « pv » que le worker Typst
 * compilera et scellera (poinçon SHA-256 + page /verifier).
 */
export async function requestPvExportAction(slug: string, input: unknown): Promise<ActionResult<{ exportId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ reviewId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de revue invalide.') };
  try {
    const exportId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createExport(tx, { tenantId: auth.tenantId, type: 'pv', objectRef: parsed.data.reviewId, requestedBy: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'export.request', objectType: 'export', objectId: id, after: { type: 'pv', reviewId: parsed.data.reviewId }, ip: auth.ip, userAgent: auth.userAgent });
      return id;
    });
    revalidatePath(`/t/${slug}/revue-direction`);
    return { ok: true, data: { exportId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_EXPORT', 'La demande de procès-verbal a échoué — réessayez.')) };
  }
}

export async function getReviewAction(
  slug: string,
  reviewId: string,
): Promise<ActionResult<{ review: ReviewDetail; exports: ExportSummary[] }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(reviewId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const data = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const review = await getReview(tx, parsed.data);
      if (!review) return null;
      const exports = await listExportsForObject(tx, parsed.data);
      return { review, exports };
    });
    if (!data) return { ok: false, error: appError('INTROUVABLE', 'Revue introuvable.') };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué.')) };
  }
}
