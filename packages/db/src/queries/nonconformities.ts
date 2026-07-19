import {
  effectivenessCheckDate,
  effectivenessDue,
  type NcGravity,
  type NcSource,
  type NcStatus,
} from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des non-conformités & CAPA (module 7.2) ─────────────
// RLS active. Les actions correctives vivent dans le moteur COMMUN du plan
// d'action (origin_type = 'nc'). RM §7.2 : la clôture planifie la vérification
// d'efficacité à J+90 (calcul @toron/core).

export interface CreateNcInput {
  tenantId: string;
  title: string;
  description?: string | null;
  source: NcSource;
  gravity: NcGravity;
  costEstimate?: number | null;
  processRef?: string | null;
  detectedBy: string;
  ownerUserId?: string | null;
}

export async function createNc(tx: TenantTx, input: CreateNcInput): Promise<string> {
  const [row] = await tx
    .insert(schema.nonconformities)
    .values({
      tenantId: input.tenantId,
      title: input.title,
      description: input.description ?? null,
      source: input.source,
      gravity: input.gravity,
      costEstimate: input.costEstimate != null ? String(input.costEstimate) : null,
      processRef: input.processRef ?? null,
      detectedBy: input.detectedBy,
      ownerUserId: input.ownerUserId ?? null,
    })
    .returning({ id: schema.nonconformities.id });
  return row!.id;
}

export interface UpdateNcInput {
  ncId: string;
  immediateAction?: string | null;
  rootCause?: unknown;
  gravity?: NcGravity;
  costEstimate?: number | null;
  processRef?: string | null;
  status?: Extract<NcStatus, 'ouverte' | 'en_traitement'>;
}

/** Met à jour les étapes d'analyse d'une NC (action immédiate, 5 pourquoi…). */
export async function updateNcSteps(tx: TenantTx, input: UpdateNcInput): Promise<number> {
  const set: Partial<typeof schema.nonconformities.$inferInsert> = {};
  if (input.immediateAction !== undefined) set.immediateAction = input.immediateAction;
  if (input.rootCause !== undefined) set.rootCause = input.rootCause;
  if (input.gravity !== undefined) set.gravity = input.gravity;
  if (input.costEstimate !== undefined) set.costEstimate = input.costEstimate != null ? String(input.costEstimate) : null;
  if (input.processRef !== undefined) set.processRef = input.processRef;
  if (input.status !== undefined) set.status = input.status;
  if (Object.keys(set).length === 0) return 0;
  const updated = await tx
    .update(schema.nonconformities)
    .set(set)
    .where(eq(schema.nonconformities.id, input.ncId))
    .returning({ id: schema.nonconformities.id });
  return updated.length;
}

/** Clôture une NC : statut « à vérifier » + vérification d'efficacité à J+90 (RM §7.2). */
export async function closeNc(tx: TenantTx, ncId: string): Promise<number> {
  const closedAt = new Date();
  const checkAt = effectivenessCheckDate(closedAt).toISOString().slice(0, 10);
  const updated = await tx
    .update(schema.nonconformities)
    .set({ status: 'cloturee_a_verifier', closedAt, effectivenessCheckAt: checkAt })
    .where(eq(schema.nonconformities.id, ncId))
    .returning({ id: schema.nonconformities.id });
  return updated.length;
}

export async function confirmEffective(tx: TenantTx, ncId: string): Promise<number> {
  const updated = await tx
    .update(schema.nonconformities)
    .set({ status: 'efficace' })
    .where(eq(schema.nonconformities.id, ncId))
    .returning({ id: schema.nonconformities.id });
  return updated.length;
}

export async function reopenNc(tx: TenantTx, ncId: string): Promise<number> {
  const updated = await tx
    .update(schema.nonconformities)
    .set({ status: 'rouverte', closedAt: null, effectivenessCheckAt: null })
    .where(eq(schema.nonconformities.id, ncId))
    .returning({ id: schema.nonconformities.id });
  return updated.length;
}

export interface NcSummary {
  id: string;
  title: string;
  source: NcSource;
  gravity: NcGravity;
  processRef: string | null;
  costEstimate: number | null;
  status: NcStatus;
  ownerName: string | null;
  effectivenessCheckAt: string | null;
  effectivenessDue: boolean;
  correctiveActionCount: number;
}

interface RawNc {
  id: string;
  title: string;
  source: NcSource;
  gravity: NcGravity;
  process_ref: string | null;
  cost_estimate: string | null;
  status: NcStatus;
  owner_name: string | null;
  effectiveness_check_at: string | null;
  corrective_count: number | string;
}

export async function listNc(tx: TenantTx): Promise<NcSummary[]> {
  const rows = await tx.execute(sql`
    SELECT n.id, n.title, n.source, n.gravity, n.process_ref, n.cost_estimate::text AS cost_estimate,
           n.status, u.name AS owner_name, n.effectiveness_check_at::text AS effectiveness_check_at,
           (SELECT count(*) FROM actions a WHERE a.origin_type = 'nc' AND a.origin_id = n.id) AS corrective_count
    FROM nonconformities n LEFT JOIN users u ON u.id = n.owner_user_id
    ORDER BY (n.status = 'efficace'), n.opened_at DESC
  `);
  const now = new Date();
  return (rows as unknown as RawNc[]).map((r) => ({
    id: r.id,
    title: r.title,
    source: r.source,
    gravity: r.gravity,
    processRef: r.process_ref,
    costEstimate: r.cost_estimate != null ? Number(r.cost_estimate) : null,
    status: r.status,
    ownerName: r.owner_name,
    effectivenessCheckAt: r.effectiveness_check_at,
    effectivenessDue: effectivenessDue(r.status, r.effectiveness_check_at ? new Date(r.effectiveness_check_at) : null, now),
    correctiveActionCount: Number(r.corrective_count),
  }));
}

export interface NcCorrectiveAction {
  id: string;
  title: string;
  status: string;
}
export interface NcDetail extends NcSummary {
  description: string | null;
  immediateAction: string | null;
  rootCause: unknown;
  correctiveActions: NcCorrectiveAction[];
}

export async function getNc(tx: TenantTx, ncId: string): Promise<NcDetail | null> {
  const base = (await listNc(tx)).find((n) => n.id === ncId);
  if (!base) return null;
  const [extra] = (await tx.execute(sql`
    SELECT description, immediate_action, root_cause FROM nonconformities WHERE id = ${ncId}
  `)) as unknown as { description: string | null; immediate_action: string | null; root_cause: unknown }[];
  const actions = (await tx.execute(sql`
    SELECT id, title, status FROM actions WHERE origin_type = 'nc' AND origin_id = ${ncId} ORDER BY created_at
  `)) as unknown as { id: string; title: string; status: string }[];
  const parse = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
  return {
    ...base,
    description: extra?.description ?? null,
    immediateAction: extra?.immediate_action ?? null,
    rootCause: extra?.root_cause != null ? parse(extra.root_cause) : null,
    correctiveActions: actions.map((a) => ({ id: a.id, title: a.title, status: a.status })),
  };
}
