import {
  activityContinuityState,
  biaReviewDue,
  continuitySummary,
  type ActivityContinuityState,
  type ContinuitySummary,
  type Criticality,
  type ExerciseKind,
  type ExerciseResult,
  type ExerciseStatus,
} from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Continuité d'activité (migration 0035) ─────────────────────────────
// Opère sur une TenantTx (RLS active) : chaque table, et les jointures vers
// actifs, fournisseurs, processus et documents, sont bornées à l'organisation.

type Ref = { id: string; name: string };

const parseJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

export interface ContinuityActivityRow {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  processId: string | null;
  processName: string | null;
  criticality: Criticality;
  rtoHours: number;
  rpoHours: number;
  degradedMode: string | null;
  planDocumentId: string | null;
  planDocumentTitle: string | null;
  assessedOn: string;
  biaDueOn: string;
  assets: Ref[];
  suppliers: Ref[];
  /** Dernier exercice réalisé qui couvre l'activité. */
  lastExercise: { id: string; title: string; heldOn: string; result: ExerciseResult; recoveryMinutes: number | null } | null;
  /** Prochain exercice planifié qui la couvre. */
  nextExerciseOn: string | null;
  state: ActivityContinuityState;
}

interface RawActivity {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  process_id: string | null;
  process_name: string | null;
  criticality: number;
  rto_hours: number;
  rpo_hours: number;
  degraded_mode: string | null;
  plan_document_id: string | null;
  plan_document_title: string | null;
  assessed_on: string;
  assets: unknown;
  suppliers: unknown;
  last_exercise: unknown;
  next_exercise_on: string | null;
}

/** Activités critiques, les plus critiques d'abord, avec dépendances et dernier exercice. */
export async function listContinuityActivities(tx: TenantTx, today: string): Promise<ContinuityActivityRow[]> {
  const rows = (await tx.execute(sql`
    SELECT a.id, a.name, a.description, a.owner_user_id, u.name AS owner_name, a.process_id, p.name AS process_name,
           a.criticality, a.rto_hours, a.rpo_hours, a.degraded_mode, a.plan_document_id, d.title AS plan_document_title,
           a.assessed_on::text AS assessed_on,
           coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                     FROM continuity_activity_assets l JOIN assets s ON s.id = l.asset_id
                     WHERE l.activity_id = a.id), '[]'::json) AS assets,
           coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                     FROM continuity_activity_suppliers l JOIN suppliers s ON s.id = l.supplier_id
                     WHERE l.activity_id = a.id), '[]'::json) AS suppliers,
           (SELECT json_build_object('id', e.id, 'title', e.title, 'heldOn', e.scheduled_on::text,
                                     'result', e.result, 'recoveryMinutes', e.recovery_minutes)
              FROM continuity_exercise_activities x JOIN continuity_exercises e ON e.id = x.exercise_id
             WHERE x.activity_id = a.id AND e.status = 'realise'
             ORDER BY e.scheduled_on DESC, e.created_at DESC LIMIT 1) AS last_exercise,
           (SELECT min(e.scheduled_on)::text
              FROM continuity_exercise_activities x JOIN continuity_exercises e ON e.id = x.exercise_id
             WHERE x.activity_id = a.id AND e.status = 'planifie' AND e.scheduled_on >= ${today}) AS next_exercise_on
    FROM continuity_activities a
    LEFT JOIN users u ON u.id = a.owner_user_id
    LEFT JOIN processes p ON p.id = a.process_id
    LEFT JOIN documents d ON d.id = a.plan_document_id
    ORDER BY a.criticality DESC, a.rto_hours, a.name
  `)) as unknown as RawActivity[];
  return rows.map((r) => {
    const last = r.last_exercise ? parseJson<ContinuityActivityRow['lastExercise']>(r.last_exercise) : null;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      ownerUserId: r.owner_user_id,
      ownerName: r.owner_name,
      processId: r.process_id,
      processName: r.process_name,
      criticality: r.criticality as Criticality,
      rtoHours: r.rto_hours,
      rpoHours: r.rpo_hours,
      degradedMode: r.degraded_mode,
      planDocumentId: r.plan_document_id,
      planDocumentTitle: r.plan_document_title,
      assessedOn: r.assessed_on,
      biaDueOn: biaReviewDue(r.assessed_on),
      assets: parseJson<Ref[]>(r.assets),
      suppliers: parseJson<Ref[]>(r.suppliers),
      lastExercise: last,
      nextExerciseOn: r.next_exercise_on,
      state: activityContinuityState({ rtoHours: r.rto_hours, lastExercise: last }, today),
    };
  });
}

export interface ContinuityActivityInput {
  name: string;
  description: string | null;
  ownerUserId: string | null;
  processId: string | null;
  criticality: Criticality;
  rtoHours: number;
  rpoHours: number;
  degradedMode: string | null;
  planDocumentId: string | null;
  assessedOn: string;
}

async function setActivityDependencies(
  tx: TenantTx, tenantId: string, activityId: string, assetIds: readonly string[], supplierIds: readonly string[],
): Promise<void> {
  await tx.delete(schema.continuityActivityAssets).where(eq(schema.continuityActivityAssets.activityId, activityId));
  await tx.delete(schema.continuityActivitySuppliers).where(eq(schema.continuityActivitySuppliers.activityId, activityId));
  const assets = [...new Set(assetIds)];
  const suppliers = [...new Set(supplierIds)];
  if (assets.length > 0) await tx.insert(schema.continuityActivityAssets).values(assets.map((assetId) => ({ tenantId, activityId, assetId })));
  if (suppliers.length > 0) await tx.insert(schema.continuityActivitySuppliers).values(suppliers.map((supplierId) => ({ tenantId, activityId, supplierId })));
}

/** Enregistre le bilan d'impact d'une activité et ses dépendances. Renvoie son id. */
export async function createContinuityActivity(
  tx: TenantTx,
  input: ContinuityActivityInput & { tenantId: string; createdBy: string },
  deps: { assetIds: readonly string[]; supplierIds: readonly string[] },
): Promise<string> {
  const [row] = await tx.insert(schema.continuityActivities).values(input).returning({ id: schema.continuityActivities.id });
  await setActivityDependencies(tx, input.tenantId, row!.id, deps.assetIds, deps.supplierIds);
  return row!.id;
}

/** Met à jour un bilan d'impact et remplace ses dépendances. Renvoie le nombre de lignes. */
export async function updateContinuityActivity(
  tx: TenantTx, tenantId: string, activityId: string, input: ContinuityActivityInput,
  deps: { assetIds: readonly string[]; supplierIds: readonly string[] },
): Promise<number> {
  const updated = await tx.update(schema.continuityActivities).set(input)
    .where(eq(schema.continuityActivities.id, activityId)).returning({ id: schema.continuityActivities.id });
  if (updated.length > 0) await setActivityDependencies(tx, tenantId, activityId, deps.assetIds, deps.supplierIds);
  return updated.length;
}

export async function deleteContinuityActivity(tx: TenantTx, activityId: string): Promise<{ name: string } | null> {
  const [row] = await tx.delete(schema.continuityActivities).where(eq(schema.continuityActivities.id, activityId))
    .returning({ name: schema.continuityActivities.name });
  return row ?? null;
}

export interface ContinuityExerciseRow {
  id: string;
  title: string;
  kind: ExerciseKind;
  scheduledOn: string;
  status: ExerciseStatus;
  result: ExerciseResult | null;
  recoveryMinutes: number | null;
  findings: string | null;
  evidenceId: string | null;
  evidenceTitle: string | null;
  leadUserId: string | null;
  leadName: string | null;
  activities: Ref[];
  /** Actions correctives ouvertes depuis l'exercice, et celles encore en cours. */
  actionCount: number;
  openActionCount: number;
}

interface RawExercise {
  id: string;
  title: string;
  kind: ExerciseKind;
  scheduled_on: string;
  status: ExerciseStatus;
  result: ExerciseResult | null;
  recovery_minutes: number | null;
  findings: string | null;
  evidence_id: string | null;
  evidence_title: string | null;
  lead_user_id: string | null;
  lead_name: string | null;
  activities: unknown;
  action_count: number | string;
  open_action_count: number | string;
}

/** Exercices et tests, les plus récents d'abord, avec les activités couvertes. */
export async function listContinuityExercises(tx: TenantTx): Promise<ContinuityExerciseRow[]> {
  const rows = (await tx.execute(sql`
    SELECT e.id, e.title, e.kind, e.scheduled_on::text AS scheduled_on, e.status, e.result, e.recovery_minutes, e.findings,
           e.evidence_id, ev.title AS evidence_title, e.lead_user_id, lu.name AS lead_name,
           coalesce((SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.criticality DESC, a.name)
                     FROM continuity_exercise_activities x JOIN continuity_activities a ON a.id = x.activity_id
                     WHERE x.exercise_id = e.id), '[]'::json) AS activities,
           (SELECT count(*) FROM actions ac WHERE ac.origin_type = 'exercise' AND ac.origin_id = e.id) AS action_count,
           (SELECT count(*) FROM actions ac WHERE ac.origin_type = 'exercise' AND ac.origin_id = e.id AND ac.status <> 'termine') AS open_action_count
    FROM continuity_exercises e
    LEFT JOIN evidences ev ON ev.id = e.evidence_id
    LEFT JOIN users lu ON lu.id = e.lead_user_id
    ORDER BY e.scheduled_on DESC, e.created_at DESC
  `)) as unknown as RawExercise[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    scheduledOn: r.scheduled_on,
    status: r.status,
    result: r.result,
    recoveryMinutes: r.recovery_minutes,
    findings: r.findings,
    evidenceId: r.evidence_id,
    evidenceTitle: r.evidence_title,
    leadUserId: r.lead_user_id,
    leadName: r.lead_name,
    activities: parseJson<Ref[]>(r.activities),
    actionCount: Number(r.action_count),
    openActionCount: Number(r.open_action_count),
  }));
}

export interface ContinuityExerciseInput {
  title: string;
  kind: ExerciseKind;
  scheduledOn: string;
  status: ExerciseStatus;
  result: ExerciseResult | null;
  recoveryMinutes: number | null;
  findings: string | null;
  evidenceId: string | null;
  leadUserId: string | null;
}

async function setExerciseActivities(tx: TenantTx, tenantId: string, exerciseId: string, activityIds: readonly string[]): Promise<void> {
  await tx.delete(schema.continuityExerciseActivities).where(eq(schema.continuityExerciseActivities.exerciseId, exerciseId));
  const unique = [...new Set(activityIds)];
  if (unique.length > 0) {
    await tx.insert(schema.continuityExerciseActivities).values(unique.map((activityId) => ({ tenantId, exerciseId, activityId })));
  }
}

export async function createContinuityExercise(
  tx: TenantTx, input: ContinuityExerciseInput & { tenantId: string; createdBy: string }, activityIds: readonly string[],
): Promise<string> {
  const [row] = await tx.insert(schema.continuityExercises).values(input).returning({ id: schema.continuityExercises.id });
  await setExerciseActivities(tx, input.tenantId, row!.id, activityIds);
  return row!.id;
}

export async function updateContinuityExercise(
  tx: TenantTx, tenantId: string, exerciseId: string, input: ContinuityExerciseInput, activityIds: readonly string[],
): Promise<number> {
  const updated = await tx.update(schema.continuityExercises).set(input)
    .where(eq(schema.continuityExercises.id, exerciseId)).returning({ id: schema.continuityExercises.id });
  if (updated.length > 0) await setExerciseActivities(tx, tenantId, exerciseId, activityIds);
  return updated.length;
}

export async function deleteContinuityExercise(tx: TenantTx, exerciseId: string): Promise<{ title: string } | null> {
  const [row] = await tx.delete(schema.continuityExercises).where(eq(schema.continuityExercises.id, exerciseId))
    .returning({ title: schema.continuityExercises.title });
  return row ?? null;
}

export type ContinuityOverview = ContinuitySummary & { exercisesPlanned: number };

/** Vue de pilotage : activités, exercices planifiés. */
export async function getContinuityOverview(tx: TenantTx, today: string): Promise<ContinuityOverview> {
  const activities = await listContinuityActivities(tx, today);
  const [planned] = (await tx.execute(sql`
    SELECT count(*) AS n FROM continuity_exercises WHERE status = 'planifie' AND scheduled_on >= ${today}
  `)) as unknown as { n: number | string }[];
  return { ...continuitySummary(activities, today), exercisesPlanned: Number(planned?.n ?? 0) };
}
