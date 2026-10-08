'use server';

import {
  EXERCISE_KINDS,
  EXERCISE_RESULTS,
  EXERCISE_STATUSES,
  activityError,
  appError,
  canManageContinuity,
  exerciseError,
} from '@toron/core';
import {
  createAction,
  createContinuityActivity,
  createContinuityExercise,
  deleteContinuityActivity,
  deleteContinuityExercise,
  getContinuityActivityRef,
  getContinuityExerciseRef,
  isTenantMember,
  notifyAssignment,
  setContinuityExerciseEvidence,
  updateContinuityActivity,
  updateContinuityExercise,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

export type { ActionResult };

const authorizeContinuityManager = (slug: string) => authorizeRole(
  slug,
  canManageContinuity,
  'Votre rôle est en lecture seule — demandez au RSSI ou au responsable de l’activité d’effectuer cette saisie.',
);

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);
const ids = z.array(z.uuid()).max(100).transform((list) => [...new Set(list)]);
const GONE_ACTIVITY = 'Cette activité n’existe plus — rechargez la page.';
const GONE_EXERCISE = 'Cet exercice n’existe plus — rechargez la page.';
const NOT_MEMBER = 'La personne choisie ne fait plus partie de l’organisation — choisissez-en une autre.';

const revalidate = (slug: string) => revalidatePath(`/t/${slug}/continuite`);

// ── Activités critiques (bilan d'impact) ───────────────────────────────
const ActivitySchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: optionalText(2000),
  ownerUserId: z.uuid().nullable(),
  processId: z.uuid().nullable(),
  criticality: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  rtoHours: z.number().int().min(0).max(8760),
  rpoHours: z.number().int().min(0).max(8760),
  degradedMode: optionalText(4000),
  planDocumentId: z.uuid().nullable(),
  assessedOn: Day,
  assetIds: ids,
  supplierIds: ids,
});

const ACTIVITY_INVALID = 'Activité incomplète — nom, criticité, DMIA et PDMA (en heures) et date du bilan sont requis.';

function activityRuleError(d: { rtoHours: number; rpoHours: number; assessedOn: string }): string | null {
  if (d.assessedOn > todayParis()) return 'La date du bilan d’impact ne peut pas être dans le futur.';
  return activityError(d);
}

export async function createContinuityActivityAction(slug: string, input: unknown): Promise<ActionResult<{ activityId: string }>> {
  const auth = await authorizeContinuityManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ActivitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', ACTIVITY_INVALID) };
  const { assetIds, supplierIds, ...d } = parsed.data;
  const ruleError = activityRuleError(d);
  if (ruleError) return { ok: false, error: appError('ACTIVITE_INVALIDE', ruleError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (d.ownerUserId && !(await isTenantMember(tx, d.ownerUserId))) return { kind: 'membre' as const };
      const id = await createContinuityActivity(tx, { ...d, tenantId: auth.tenantId, createdBy: auth.userId }, { assetIds, supplierIds });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'continuity.activity_create', objectType: 'continuity_activity', objectId: id,
        after: { name: d.name, criticality: d.criticality, rtoHours: d.rtoHours, rpoHours: d.rpoHours, assets: assetIds.length, suppliers: supplierIds.length },
        ip: auth.ip, userAgent: auth.userAgent,
      });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'activite', objectId: id, objectTitle: d.name, previousOwnerId: null, nextOwnerId: d.ownerUserId });
      return { kind: 'ok' as const, id };
    });
    if (res.kind === 'membre') return { ok: false, error: appError('RESPONSABLE_INVALIDE', NOT_MEMBER) };
    revalidate(slug);
    return { ok: true, data: { activityId: res.id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’enregistrement de l’activité a échoué — vérifiez le processus, le plan et les dépendances choisis, puis réessayez.')) };
  }
}

const ActivityUpdateSchema = ActivitySchema.extend({ activityId: z.uuid() });

export async function updateContinuityActivityAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeContinuityManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ActivityUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', ACTIVITY_INVALID) };
  const { activityId, assetIds, supplierIds, ...d } = parsed.data;
  const ruleError = activityRuleError(d);
  if (ruleError) return { ok: false, error: appError('ACTIVITE_INVALIDE', ruleError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getContinuityActivityRef(tx, activityId);
      if (!ref) return { kind: 'introuvable' as const };
      if (d.ownerUserId && d.ownerUserId !== ref.ownerUserId && !(await isTenantMember(tx, d.ownerUserId))) return { kind: 'membre' as const };
      if ((await updateContinuityActivity(tx, auth.tenantId, activityId, d, { assetIds, supplierIds })) === 0) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'continuity.activity_update', objectType: 'continuity_activity', objectId: activityId,
        before: { name: ref.name, criticality: ref.criticality, rtoHours: ref.rtoHours, rpoHours: ref.rpoHours },
        after: { name: d.name, criticality: d.criticality, rtoHours: d.rtoHours, rpoHours: d.rpoHours, assets: assetIds.length, suppliers: supplierIds.length },
        ip: auth.ip, userAgent: auth.userAgent,
      });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'activite', objectId: activityId, objectTitle: d.name, previousOwnerId: ref.ownerUserId, nextOwnerId: d.ownerUserId });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE_ACTIVITY) };
    if (res.kind === 'membre') return { ok: false, error: appError('RESPONSABLE_INVALIDE', NOT_MEMBER) };
    revalidate(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour de l’activité a échoué — vérifiez le processus, le plan et les dépendances choisis, puis réessayez.')) };
  }
}

const RefSchema = z.object({ id: z.uuid() });

export async function deleteContinuityActivityAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeContinuityManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = RefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Suppression invalide — rechargez la page.') };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getContinuityActivityRef(tx, parsed.data.id);
      if (!ref || !(await deleteContinuityActivity(tx, parsed.data.id))) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'continuity.activity_delete', objectType: 'continuity_activity', objectId: parsed.data.id,
        before: { name: ref.name, criticality: ref.criticality, rtoHours: ref.rtoHours, rpoHours: ref.rpoHours },
        ip: auth.ip, userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE_ACTIVITY) };
    revalidate(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression de l’activité a échoué — réessayez.')) };
  }
}

// ── Exercices et tests ─────────────────────────────────────────────────
const ExerciseSchema = z.object({
  title: z.string().trim().min(2).max(200),
  kind: z.enum(EXERCISE_KINDS),
  scheduledOn: Day,
  status: z.enum(EXERCISE_STATUSES),
  result: z.enum(EXERCISE_RESULTS).nullable(),
  recoveryMinutes: z.number().int().min(0).max(525600).nullable(),
  findings: optionalText(4000),
  evidenceId: z.uuid().nullable(),
  leadUserId: z.uuid().nullable(),
  activityIds: ids,
});

const EXERCISE_INVALID = 'Exercice incomplet — intitulé, type, date et statut sont requis.';

export async function createContinuityExerciseAction(slug: string, input: unknown): Promise<ActionResult<{ exerciseId: string }>> {
  const auth = await authorizeContinuityManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ExerciseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', EXERCISE_INVALID) };
  const { activityIds, ...d } = parsed.data;
  const ruleError = exerciseError(d, todayParis());
  if (ruleError) return { ok: false, error: appError('EXERCICE_INVALIDE', ruleError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (d.leadUserId && !(await isTenantMember(tx, d.leadUserId))) return { kind: 'membre' as const };
      const id = await createContinuityExercise(tx, { ...d, tenantId: auth.tenantId, createdBy: auth.userId }, activityIds);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'continuity.exercise_create', objectType: 'continuity_exercise', objectId: id,
        after: { title: d.title, kind: d.kind, scheduledOn: d.scheduledOn, status: d.status, result: d.result, recoveryMinutes: d.recoveryMinutes, activities: activityIds.length },
        ip: auth.ip, userAgent: auth.userAgent,
      });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'exercice', objectId: id, objectTitle: d.title, previousOwnerId: null, nextOwnerId: d.leadUserId });
      return { kind: 'ok' as const, id };
    });
    if (res.kind === 'membre') return { ok: false, error: appError('PILOTE_INVALIDE', NOT_MEMBER) };
    revalidate(slug);
    return { ok: true, data: { exerciseId: res.id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’enregistrement de l’exercice a échoué — vérifiez les activités et le rapport choisis, puis réessayez.')) };
  }
}

const ExerciseUpdateSchema = ExerciseSchema.extend({ exerciseId: z.uuid() });

export async function updateContinuityExerciseAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeContinuityManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ExerciseUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', EXERCISE_INVALID) };
  const { exerciseId, activityIds, ...d } = parsed.data;
  const ruleError = exerciseError(d, todayParis());
  if (ruleError) return { ok: false, error: appError('EXERCICE_INVALIDE', ruleError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getContinuityExerciseRef(tx, exerciseId);
      if (!ref) return { kind: 'introuvable' as const };
      if (d.leadUserId && d.leadUserId !== ref.leadUserId && !(await isTenantMember(tx, d.leadUserId))) return { kind: 'membre' as const };
      if ((await updateContinuityExercise(tx, auth.tenantId, exerciseId, d, activityIds)) === 0) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'continuity.exercise_update', objectType: 'continuity_exercise', objectId: exerciseId,
        before: { title: ref.title, status: ref.status, result: ref.result, recoveryMinutes: ref.recoveryMinutes },
        after: { title: d.title, status: d.status, result: d.result, recoveryMinutes: d.recoveryMinutes, activities: activityIds.length },
        ip: auth.ip, userAgent: auth.userAgent,
      });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'exercice', objectId: exerciseId, objectTitle: d.title, previousOwnerId: ref.leadUserId, nextOwnerId: d.leadUserId });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE_EXERCISE) };
    if (res.kind === 'membre') return { ok: false, error: appError('PILOTE_INVALIDE', NOT_MEMBER) };
    revalidate(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour de l’exercice a échoué — vérifiez les activités et le rapport choisis, puis réessayez.')) };
  }
}

export async function deleteContinuityExerciseAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeContinuityManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = RefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Suppression invalide — rechargez la page.') };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getContinuityExerciseRef(tx, parsed.data.id);
      if (!ref || !(await deleteContinuityExercise(tx, parsed.data.id))) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'continuity.exercise_delete', objectType: 'continuity_exercise', objectId: parsed.data.id,
        before: { title: ref.title, status: ref.status, result: ref.result, scheduledOn: ref.scheduledOn },
        ip: auth.ip, userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE_EXERCISE) };
    revalidate(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression de l’exercice a échoué — réessayez.')) };
  }
}

const ReportSchema = z.object({ exerciseId: z.uuid(), evidenceId: z.uuid() });

/** Rattache le rapport d'un exercice réalisé, déposé au coffre de preuves. */
export async function attachExerciseReportAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeContinuityManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Rapport invalide — rechargez la page.') };
  const { exerciseId, evidenceId } = parsed.data;
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getContinuityExerciseRef(tx, exerciseId);
      if (!ref) return { kind: 'introuvable' as const };
      if (ref.status !== 'realise') return { kind: 'non_realise' as const };
      if (!(await setContinuityExerciseEvidence(tx, exerciseId, evidenceId))) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'continuity.exercise_report', objectType: 'continuity_exercise', objectId: exerciseId,
        before: { evidenceId: ref.evidenceId }, after: { evidenceId }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE_EXERCISE) };
    if (res.kind === 'non_realise') return { ok: false, error: appError('EXERCICE_NON_REALISE', 'Le rapport se dépose une fois l’exercice réalisé.') };
    revalidate(slug);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_RATTACHEMENT', 'Le rattachement du rapport a échoué — réessayez.')) };
  }
}

const CorrectiveSchema = z.object({
  exerciseId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  ownerUserId: z.uuid().nullable(),
  dueDate: Day,
  priority: z.enum(['p1', 'p2', 'p3']),
});

/** Ouvre une action corrective à partir des enseignements d'un exercice réalisé. */
export async function planExerciseActionAction(slug: string, input: unknown): Promise<ActionResult<{ actionId: string }>> {
  const auth = await authorizeContinuityManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = CorrectiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Action invalide — un intitulé (3 caractères au moins) et une échéance sont requis.') };
  const d = parsed.data;
  if (d.dueDate < todayParis()) return { ok: false, error: appError('ECHEANCE_PASSEE', 'L’échéance est déjà passée — choisissez une date à venir.') };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getContinuityExerciseRef(tx, d.exerciseId);
      if (!ref) return { kind: 'introuvable' as const };
      if (ref.status !== 'realise') return { kind: 'non_realise' as const };
      const ownerUserId = d.ownerUserId ?? auth.userId;
      if (!(await isTenantMember(tx, ownerUserId))) return { kind: 'membre' as const };
      const id = await createAction(tx, {
        tenantId: auth.tenantId, title: d.title, description: ref.findings, originType: 'exercise', originId: d.exerciseId,
        ownerUserId, dueDate: d.dueDate, priority: d.priority,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'continuity.exercise_action', objectType: 'action', objectId: id,
        after: { exerciseId: d.exerciseId, dueDate: d.dueDate, priority: d.priority }, ip: auth.ip, userAgent: auth.userAgent,
      });
      await notifyAssignment(tx, { tenantId: auth.tenantId, slug, actorUserId: auth.userId, subject: 'action', objectId: id, objectTitle: d.title, previousOwnerId: null, nextOwnerId: ownerUserId });
      return { kind: 'ok' as const, id };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE_EXERCISE) };
    if (res.kind === 'non_realise') return { ok: false, error: appError('EXERCICE_NON_REALISE', 'Les actions correctives s’ouvrent une fois l’exercice réalisé.') };
    if (res.kind === 'membre') return { ok: false, error: appError('RESPONSABLE_INVALIDE', NOT_MEMBER) };
    revalidate(slug);
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: { actionId: res.id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’ouverture de l’action a échoué — réessayez.')) };
  }
}
