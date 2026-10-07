'use server';

import {
  appError,
  canRequestException,
  exceptionCloseVerdict,
  exceptionDecisionVerdict,
  exceptionEditVerdict,
  exceptionRenewalVerdict,
  exceptionWindowError,
} from '@toron/core';
import {
  closeException,
  createException,
  decideException,
  getExceptionRef,
  isTenantMember,
  notifyAssignment,
  notifyExceptionDecision,
  updateExceptionRequest,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

export type { ActionResult };

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalNote = z.string().trim().max(2000).nullable().optional().transform((v) => v || null);

const authorizeRequester = (slug: string) => authorizeRole(
  slug,
  canRequestException,
  'Votre rôle est en lecture seule — demandez à un gestionnaire de saisir cette dérogation.',
);
// Statuer est ouvert à tout membre authentifié ; la règle métier (rôle,
// séparation des tâches) tranche ensuite avec un motif précis.
const authorizeMember = (slug: string) => authorizeRole(slug, () => true, 'Accès refusé.');

const ContentShape = {
  title: z.string().trim().min(2).max(200),
  rule: z.string().trim().min(2).max(300),
  justification: z.string().trim().min(10).max(4000),
  compensatingMeasures: z.string().trim().min(3).max(4000),
  controlId: z.uuid().nullable(),
  assetId: z.uuid().nullable(),
  ownerUserId: z.uuid().nullable(),
  startsOn: Day,
  expiresOn: Day,
};

const INVALID = 'Dérogation incomplète — intitulé, règle concernée, justification (10 caractères au moins), mesures compensatoires et dates sont requis.';

const RequestSchema = z.object({ ...ContentShape, renewedFromId: z.uuid().nullable().optional() });

/** Demande une dérogation, ou le renouvellement d'une dérogation accordée. */
export async function requestExceptionAction(slug: string, input: unknown): Promise<ActionResult<{ exceptionId: string }>> {
  const auth = await authorizeRequester(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', INVALID) };
  const d = parsed.data;
  const windowError = exceptionWindowError(d.startsOn, d.expiresOn, todayParis());
  if (windowError) return { ok: false, error: appError('FENETRE_INVALIDE', windowError) };
  const ownerUserId = d.ownerUserId ?? auth.userId;
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (d.renewedFromId) {
        const origin = await getExceptionRef(tx, d.renewedFromId);
        if (!origin) return { kind: 'introuvable' as const };
        const verdict = exceptionRenewalVerdict({ role: auth.role, actorUserId: auth.userId }, origin);
        if (!verdict.ok) return { kind: 'refus' as const, reason: verdict.reason };
      }
      if (!(await isTenantMember(tx, ownerUserId))) return { kind: 'responsable' as const };
      const id = await createException(tx, {
        tenantId: auth.tenantId,
        requestedBy: auth.userId,
        renewedFromId: d.renewedFromId ?? null,
        title: d.title,
        rule: d.rule,
        justification: d.justification,
        compensatingMeasures: d.compensatingMeasures,
        controlId: d.controlId,
        assetId: d.assetId,
        ownerUserId,
        startsOn: d.startsOn,
        expiresOn: d.expiresOn,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: d.renewedFromId ? 'exception.renew' : 'exception.request',
        objectType: 'policy_exception',
        objectId: id,
        after: { title: d.title, startsOn: d.startsOn, expiresOn: d.expiresOn, renewedFromId: d.renewedFromId ?? null },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'derogation', objectId: id, objectTitle: d.title, previousOwnerId: null, nextOwnerId: ownerUserId });
      return { kind: 'ok' as const, id };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'La dérogation à renouveler n’existe plus — rechargez la page.') };
    if (res.kind === 'refus') return { ok: false, error: appError('RENOUVELLEMENT_REFUSE', res.reason) };
    if (res.kind === 'responsable') return { ok: false, error: appError('RESPONSABLE_INVALIDE', 'Le responsable choisi ne fait plus partie de l’organisation — choisissez-en un autre.') };
    revalidatePath(`/t/${slug}/derogations`);
    return { ok: true, data: { exceptionId: res.id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’enregistrement de la demande a échoué — vérifiez le contrôle et l’actif choisis, puis réessayez.')) };
  }
}

const UpdateSchema = z.object({ exceptionId: z.uuid(), ...ContentShape });

/** Modifie une demande tant qu'elle n'est pas tranchée. */
export async function updateExceptionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRequester(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', INVALID) };
  const d = parsed.data;
  const windowError = exceptionWindowError(d.startsOn, d.expiresOn, todayParis());
  if (windowError) return { ok: false, error: appError('FENETRE_INVALIDE', windowError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getExceptionRef(tx, d.exceptionId);
      if (!ref) return { kind: 'introuvable' as const };
      const verdict = exceptionEditVerdict({ role: auth.role, actorUserId: auth.userId }, ref);
      if (!verdict.ok) return { kind: 'refus' as const, reason: verdict.reason };
      const ownerUserId = d.ownerUserId ?? ref.ownerUserId;
      if (!(await isTenantMember(tx, ownerUserId))) return { kind: 'responsable' as const };
      const n = await updateExceptionRequest(tx, d.exceptionId, {
        title: d.title,
        rule: d.rule,
        justification: d.justification,
        compensatingMeasures: d.compensatingMeasures,
        controlId: d.controlId,
        assetId: d.assetId,
        ownerUserId,
        startsOn: d.startsOn,
        expiresOn: d.expiresOn,
      });
      if (n === 0) return { kind: 'tranchee' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'exception.update',
        objectType: 'policy_exception',
        objectId: d.exceptionId,
        after: { title: d.title, startsOn: d.startsOn, expiresOn: d.expiresOn },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'derogation', objectId: d.exceptionId, objectTitle: d.title, previousOwnerId: ref.ownerUserId, nextOwnerId: ownerUserId });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Cette dérogation n’existe plus — rechargez la page.') };
    if (res.kind === 'refus') return { ok: false, error: appError('MODIFICATION_REFUSEE', res.reason) };
    if (res.kind === 'responsable') return { ok: false, error: appError('RESPONSABLE_INVALIDE', 'Le responsable choisi ne fait plus partie de l’organisation — choisissez-en un autre.') };
    if (res.kind === 'tranchee') return { ok: false, error: appError('DEJA_TRANCHEE', 'Cette demande vient d’être tranchée : elle ne se modifie plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/derogations`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour de la demande a échoué — réessayez.')) };
  }
}

const DecideSchema = z.object({ exceptionId: z.uuid(), approve: z.boolean(), note: optionalNote });

/** Accorde ou refuse une demande ; le refus est motivé. */
export async function decideExceptionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeMember(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = DecideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Décision invalide — rechargez la page.') };
  const d = parsed.data;
  if (!d.approve && (d.note ?? '').length < 5) {
    return { ok: false, error: appError('MOTIF_REQUIS', 'Motivez le refus : le demandeur doit savoir pourquoi l’écart n’est pas accepté.') };
  }
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getExceptionRef(tx, d.exceptionId);
      if (!ref) return { kind: 'introuvable' as const };
      const verdict = exceptionDecisionVerdict({ role: auth.role, actorUserId: auth.userId }, ref);
      if (!verdict.ok) return { kind: 'refus' as const, reason: verdict.reason };
      const n = await decideException(tx, { exceptionId: d.exceptionId, decidedBy: auth.userId, approve: d.approve, note: d.note });
      if (n === 0) return { kind: 'tranchee' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: d.approve ? 'exception.approve' : 'exception.refuse',
        objectType: 'policy_exception',
        objectId: d.exceptionId,
        after: { note: d.note },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      await notifyExceptionDecision(tx, {
        tenantId: auth.tenantId, slug, actorUserId: auth.userId, exceptionId: d.exceptionId, title: ref.title,
        requestedBy: ref.requestedBy, ownerUserId: ref.ownerUserId, approved: d.approve,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Cette dérogation n’existe plus — rechargez la page.') };
    if (res.kind === 'refus') return { ok: false, error: appError('DECISION_REFUSEE', res.reason) };
    if (res.kind === 'tranchee') return { ok: false, error: appError('DEJA_TRANCHEE', 'Cette demande vient d’être tranchée par quelqu’un d’autre — rechargez la page.') };
    revalidatePath(`/t/${slug}/derogations`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_DECISION', 'L’enregistrement de la décision a échoué — réessayez.')) };
  }
}

const CloseSchema = z.object({ exceptionId: z.uuid(), note: optionalNote });

/** Retire une demande, ou met fin à une dérogation accordée parce que la règle s'applique de nouveau. */
export async function closeExceptionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeRequester(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = CloseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Clôture invalide — rechargez la page.') };
  const d = parsed.data;
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getExceptionRef(tx, d.exceptionId);
      if (!ref) return { kind: 'introuvable' as const };
      const verdict = exceptionCloseVerdict({ role: auth.role, actorUserId: auth.userId }, ref);
      if (!verdict.ok) return { kind: 'refus' as const, reason: verdict.reason };
      const n = await closeException(tx, { exceptionId: d.exceptionId, closedBy: auth.userId, note: d.note });
      if (n === 0) return { kind: 'close' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'exception.close',
        objectType: 'policy_exception',
        objectId: d.exceptionId,
        before: { status: ref.status },
        after: { note: d.note },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Cette dérogation n’existe plus — rechargez la page.') };
    if (res.kind === 'refus') return { ok: false, error: appError('CLOTURE_REFUSEE', res.reason) };
    if (res.kind === 'close') return { ok: false, error: appError('DEJA_CLOSE', 'Cette dérogation est déjà close — rechargez la page.') };
    revalidatePath(`/t/${slug}/derogations`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CLOTURE', 'La clôture a échoué — réessayez.')) };
  }
}
