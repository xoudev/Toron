'use server';

import { TRAINING_KINDS, appError, canManageTraining, trainingSessionError } from '@toron/core';
import {
  createTrainingSession,
  deleteTrainingSession,
  getTrainingSessionRef,
  listTenantMembers,
  setTrainingSessionEvidence,
  updateTrainingSession,
  withTenant,
  writeAuditEntry,
  type TenantTx,
  type TrainingSessionInput,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

export type { ActionResult };

const authorizeTrainingManager = (slug: string) => authorizeRole(
  slug,
  canManageTraining,
  'Votre rôle est en lecture seule — demandez au RSSI ou au responsable qualité d’enregistrer cette session.',
);

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);
const headcount = z.number().int().min(0).max(100000).nullable();

const SessionSchema = z.object({
  title: z.string().trim().min(2).max(200),
  kind: z.enum(TRAINING_KINDS),
  heldOn: Day,
  durationMinutes: z.number().int().min(5).max(2880).nullable(),
  audience: optionalText(300),
  expectedCount: headcount,
  attendedCount: headcount,
  provider: optionalText(200),
  notes: optionalText(4000),
  evidenceId: z.uuid().nullable(),
  attendeeIds: z.array(z.uuid()).max(200).transform((ids) => [...new Set(ids)]),
});

const INVALID = 'Session incomplète — intitulé (2 caractères au moins), type et date sont requis ; durée de 5 à 2 880 minutes, effectifs positifs.';
const MEMBERS = 'Un des membres cochés ne fait plus partie de l’organisation — rechargez la page.';
const GONE = 'Cette session n’existe plus — rechargez la page.';

/** Membres présents admis : les membres actuels, et ceux déjà enregistrés qui ont quitté l'organisation depuis. */
async function attendeesAllowed(tx: TenantTx, ids: readonly string[], recorded: readonly string[] = []): Promise<boolean> {
  if (ids.length === 0) return true;
  const members = new Set((await listTenantMembers(tx)).map((m) => m.userId));
  return ids.every((id) => members.has(id) || recorded.includes(id));
}

/** Ce que retient le journal : la session, pas l'identité des présents. */
function auditView(s: Pick<TrainingSessionInput, 'title' | 'kind' | 'heldOn' | 'expectedCount' | 'attendedCount' | 'evidenceId'>, attendeeIds: readonly string[]) {
  return {
    title: s.title, kind: s.kind, heldOn: s.heldOn, expectedCount: s.expectedCount, attendedCount: s.attendedCount,
    evidenceId: s.evidenceId, attendeeCount: attendeeIds.length,
  };
}

/** Planifie ou enregistre une session. */
export async function createTrainingSessionAction(slug: string, input: unknown): Promise<ActionResult<{ sessionId: string }>> {
  const auth = await authorizeTrainingManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', INVALID) };
  const { attendeeIds, ...d } = parsed.data;
  const ruleError = trainingSessionError({ ...d, attendeeCount: attendeeIds.length }, todayParis());
  if (ruleError) return { ok: false, error: appError('SESSION_INVALIDE', ruleError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (!(await attendeesAllowed(tx, attendeeIds))) return { kind: 'membres' as const };
      const id = await createTrainingSession(tx, { ...d, tenantId: auth.tenantId, createdBy: auth.userId }, attendeeIds);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'training.create',
        objectType: 'training_session',
        objectId: id,
        after: auditView(d, attendeeIds),
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const, id };
    });
    if (res.kind === 'membres') return { ok: false, error: appError('PRESENTS_INVALIDES', MEMBERS) };
    revalidatePath(`/t/${slug}/sensibilisation`);
    return { ok: true, data: { sessionId: res.id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’enregistrement de la session a échoué — vérifiez la feuille d’émargement choisie, puis réessayez.')) };
  }
}

const UpdateSchema = SessionSchema.extend({ sessionId: z.uuid() });

/** Modifie une session : contenu, participation, membres présents, feuille d'émargement. */
export async function updateTrainingSessionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeTrainingManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', INVALID) };
  const { sessionId, attendeeIds, ...d } = parsed.data;
  const ruleError = trainingSessionError({ ...d, attendeeCount: attendeeIds.length }, todayParis());
  if (ruleError) return { ok: false, error: appError('SESSION_INVALIDE', ruleError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getTrainingSessionRef(tx, sessionId);
      if (!ref) return { kind: 'introuvable' as const };
      if (!(await attendeesAllowed(tx, attendeeIds, ref.attendeeIds))) return { kind: 'membres' as const };
      const n = await updateTrainingSession(tx, auth.tenantId, sessionId, d, attendeeIds);
      if (n === 0) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'training.update',
        objectType: 'training_session',
        objectId: sessionId,
        before: auditView(ref, ref.attendeeIds),
        after: auditView(d, attendeeIds),
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE) };
    if (res.kind === 'membres') return { ok: false, error: appError('PRESENTS_INVALIDES', MEMBERS) };
    revalidatePath(`/t/${slug}/sensibilisation`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour de la session a échoué — vérifiez la feuille d’émargement choisie, puis réessayez.')) };
  }
}

const SessionRef = z.object({ sessionId: z.uuid() });

/** Supprime une session saisie par erreur ; le journal d'audit en garde la trace. */
export async function deleteTrainingSessionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeTrainingManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SessionRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Suppression invalide — rechargez la page.') };
  const { sessionId } = parsed.data;
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getTrainingSessionRef(tx, sessionId);
      if (!ref) return { kind: 'introuvable' as const };
      if (!(await deleteTrainingSession(tx, sessionId))) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'training.delete',
        objectType: 'training_session',
        objectId: sessionId,
        before: auditView(ref, ref.attendeeIds),
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE) };
    revalidatePath(`/t/${slug}/sensibilisation`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression de la session a échoué — réessayez.')) };
  }
}

const SheetSchema = z.object({ sessionId: z.uuid(), evidenceId: z.uuid() });

/** Rattache une feuille d'émargement déposée au coffre de preuves à une session tenue. */
export async function attachTrainingSheetAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeTrainingManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Feuille d’émargement invalide — rechargez la page.') };
  const { sessionId, evidenceId } = parsed.data;
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getTrainingSessionRef(tx, sessionId);
      if (!ref) return { kind: 'introuvable' as const };
      if (ref.heldOn > todayParis()) return { kind: 'a_venir' as const };
      if (!(await setTrainingSessionEvidence(tx, sessionId, evidenceId))) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'training.attach_sheet',
        objectType: 'training_session',
        objectId: sessionId,
        before: { evidenceId: ref.evidenceId },
        after: { evidenceId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE) };
    if (res.kind === 'a_venir') return { ok: false, error: appError('SESSION_A_VENIR', 'La feuille d’émargement se dépose une fois la session tenue.') };
    revalidatePath(`/t/${slug}/sensibilisation`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_RATTACHEMENT', 'Le rattachement de la feuille d’émargement a échoué — réessayez.')) };
  }
}
