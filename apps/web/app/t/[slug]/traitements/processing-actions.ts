'use server';

import { LEGAL_BASES, appError } from '@toron/core';
import {
  createProcessing,
  currentOwner,
  deleteProcessing,
  notifyAssignment,
  updateProcessing,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeManager, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

export type { ActionResult };

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const list = z.array(z.string().trim().min(1).max(120)).max(30);

const ProcessingSchema = z.object({
  entityId: z.uuid().nullable(),
  name: z.string().trim().min(2).max(200),
  purpose: z.string().trim().min(1).max(2000),
  legalBasis: z.enum(LEGAL_BASES),
  legalBasisDetail: optionalText(2000),
  dataSubjects: list,
  dataCategories: list,
  sensitiveData: z.boolean(),
  recipients: optionalText(2000),
  transfersOutsideEu: z.boolean(),
  transferSafeguards: optionalText(2000),
  retention: optionalText(1000),
  securityMeasures: optionalText(4000),
  ownerUserId: z.uuid().nullable(),
  lastReviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  supplierIds: z.array(z.uuid()).max(50),
});

type Parsed = z.infer<typeof ProcessingSchema>;

function businessError(d: Parsed) {
  if (d.transfersOutsideEu && !d.transferSafeguards) return appError('SAISIE_INVALIDE', 'Un transfert hors UE doit indiquer ses garanties (décision d’adéquation, clauses contractuelles types…).');
  if (d.lastReviewedOn && d.lastReviewedOn > todayParis()) return appError('SAISIE_INVALIDE', 'La date de révision ne peut pas être dans le futur.');
  return null;
}

const SAVE_FAILED = 'L’enregistrement de la fiche a échoué — vérifiez les sous-traitants et l’entité choisis, puis réessayez.';

export async function createProcessingAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ProcessingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Fiche invalide — un nom, une finalité et une base légale sont requis.') };
  const invalid = businessError(parsed.data);
  if (invalid) return { ok: false, error: invalid };
  const { supplierIds, ...data } = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const pid = await createProcessing(tx, auth.tenantId, data, supplierIds);
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'processing.create', objectType: 'processing_activity', objectId: pid, after: { legalBasis: data.legalBasis, processors: supplierIds.length }, ip: auth.ip, userAgent: auth.userAgent });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'traitement', objectId: pid, objectTitle: data.name, previousOwnerId: null, nextOwnerId: data.ownerUserId });
      return pid;
    });
    revalidatePath(`/t/${slug}/traitements`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', SAVE_FAILED)) };
  }
}

export async function updateProcessingAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ProcessingSchema.extend({ processingId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Fiche invalide — un nom, une finalité et une base légale sont requis.') };
  const invalid = businessError(parsed.data);
  if (invalid) return { ok: false, error: invalid };
  const { processingId, supplierIds, ...data } = parsed.data;
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const previousOwnerId = await currentOwner(tx, 'traitement', processingId);
      const affected = await updateProcessing(tx, auth.tenantId, processingId, data, supplierIds);
      if (affected > 0) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'processing.update', objectType: 'processing_activity', objectId: processingId, after: { legalBasis: data.legalBasis, processors: supplierIds.length, lastReviewedOn: data.lastReviewedOn }, ip: auth.ip, userAgent: auth.userAgent });
      if (affected > 0) await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'traitement', objectId: processingId, objectTitle: data.name, previousOwnerId: previousOwnerId, nextOwnerId: data.ownerUserId });
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('INTROUVABLE', 'Cette fiche n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/traitements`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', SAVE_FAILED)) };
  }
}

export async function deleteProcessingAction(slug: string, processingId: string): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(processingId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const removed = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const r = await deleteProcessing(tx, parsed.data);
      if (r) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'processing.delete', objectType: 'processing_activity', objectId: parsed.data, before: { name: r.name }, ip: auth.ip, userAgent: auth.userAgent });
      return r;
    });
    if (!removed) return { ok: false, error: appError('INTROUVABLE', 'Cette fiche a déjà été supprimée — rechargez la page.') };
    revalidatePath(`/t/${slug}/traitements`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression a échoué — réessayez.')) };
  }
}
