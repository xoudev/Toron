import {
  defaultRiskScale,
  deriveProcessHealth,
  processMutualizationCount,
  riskBand,
  type ProcessRequirement,
  type ProcessFamily,
  type ProcessHealth,
  type ProcessInteraction,
  type ProcessKpi,
  type ProcessWorkflow,
  type Sipoc,
} from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import { getActiveScale } from './risks.ts';
import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des processus (module 7.1, pack QMS) ────────────────
// Blocs SIPOC / KPI / exigences / interactions en jsonb ; la santé est
// dérivée des indicateurs (packages/core). RLS active.

// jsonb peut revenir sous forme de chaîne selon le driver — on parse défensif.
function asJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

const EMPTY_SIPOC: Sipoc = { suppliers: [], inputs: [], activities: [], outputs: [], clients: [] };

export interface CreateProcessInput {
  tenantId: string;
  family: ProcessFamily;
  name: string;
  pilotUserId?: string | null;
  version?: string;
  sipoc?: Sipoc;
  kpis?: ProcessKpi[];
  coveredRequirements?: ProcessRequirement[];
  interactions?: ProcessInteraction[];
}

export async function createProcess(tx: TenantTx, input: CreateProcessInput): Promise<string> {
  const [row] = await tx
    .insert(schema.processes)
    .values({
      tenantId: input.tenantId,
      family: input.family,
      name: input.name,
      pilotUserId: input.pilotUserId ?? null,
      version: input.version ?? 'v1.0',
      sipoc: input.sipoc ?? EMPTY_SIPOC,
      kpis: input.kpis ?? [],
      coveredRequirements: input.coveredRequirements ?? [],
      interactions: input.interactions ?? [],
    })
    .returning({ id: schema.processes.id });
  return row!.id;
}

export async function setProcessWorkflow(tx: TenantTx, processId: string, workflow: ProcessWorkflow): Promise<number> {
  const u = await tx
    .update(schema.processes)
    .set({ workflow })
    .where(eq(schema.processes.id, processId))
    .returning({ id: schema.processes.id });
  return u.length;
}

export interface UpdateProcessInput {
  name?: string;
  version?: string;
  pilotUserId?: string | null;
  sipoc?: Sipoc;
  kpis?: ProcessKpi[];
  coveredRequirements?: ProcessRequirement[];
  interactions?: ProcessInteraction[];
}

/** Met à jour les blocs de la fiche processus (SIPOC, indicateurs, exigences, interactions). */
export async function updateProcess(tx: TenantTx, processId: string, input: UpdateProcessInput): Promise<number> {
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set['name'] = input.name;
  if (input.version !== undefined) set['version'] = input.version;
  if (input.pilotUserId !== undefined) set['pilotUserId'] = input.pilotUserId;
  if (input.sipoc !== undefined) set['sipoc'] = input.sipoc;
  if (input.kpis !== undefined) set['kpis'] = input.kpis;
  if (input.coveredRequirements !== undefined) set['coveredRequirements'] = input.coveredRequirements;
  if (input.interactions !== undefined) set['interactions'] = input.interactions;
  if (Object.keys(set).length === 0) return 0;
  const u = await tx.update(schema.processes).set(set).where(eq(schema.processes.id, processId)).returning({ id: schema.processes.id });
  return u.length;
}

export async function addProcessRisk(tx: TenantTx, input: { tenantId: string; processId: string; riskId: string }): Promise<void> {
  await tx
    .insert(schema.processRisks)
    .values({ tenantId: input.tenantId, processId: input.processId, riskId: input.riskId })
    .onConflictDoNothing();
}

export async function removeProcessRisk(tx: TenantTx, processId: string, riskId: string): Promise<void> {
  await tx
    .delete(schema.processRisks)
    .where(and(eq(schema.processRisks.processId, processId), eq(schema.processRisks.riskId, riskId)));
}

export interface ProcessSummary {
  id: string;
  family: ProcessFamily;
  name: string;
  version: string;
  workflow: ProcessWorkflow;
  pilotUserId: string | null;
  pilotName: string | null;
  health: ProcessHealth;
  mutualizedCount: number;
  riskCount: number;
}

interface RawProcess {
  id: string;
  family: ProcessFamily;
  name: string;
  version: string;
  workflow: ProcessWorkflow;
  pilot_user_id: string | null;
  pilot_name: string | null;
  kpis: unknown;
  covered_requirements: unknown;
  risk_count: number | string;
}

function toSummary(r: RawProcess): ProcessSummary {
  const kpis = asJson<ProcessKpi[]>(r.kpis, []);
  const reqs = asJson<ProcessRequirement[]>(r.covered_requirements, []);
  return {
    id: r.id,
    family: r.family,
    name: r.name,
    version: r.version,
    workflow: r.workflow,
    pilotUserId: r.pilot_user_id,
    pilotName: r.pilot_name,
    health: deriveProcessHealth(kpis),
    mutualizedCount: processMutualizationCount(reqs),
    riskCount: Number(r.risk_count),
  };
}

export async function listProcesses(tx: TenantTx): Promise<ProcessSummary[]> {
  const rows = await tx.execute(sql`
    SELECT p.id, p.family, p.name, p.version, p.workflow, p.pilot_user_id,
           u.name AS pilot_name, p.kpis, p.covered_requirements,
           (SELECT count(*) FROM process_risks pr WHERE pr.process_id = p.id) AS risk_count
    FROM processes p LEFT JOIN users u ON u.id = p.pilot_user_id
    ORDER BY p.family, p.name
  `);
  return (rows as unknown as RawProcess[]).map(toSummary);
}

export interface ProcessRiskRow {
  id: string;
  title: string;
  netBand: string | null;
}
export interface ProcessDetail extends ProcessSummary {
  sipoc: Sipoc;
  kpis: ProcessKpi[];
  coveredRequirements: ProcessRequirement[];
  interactions: ProcessInteraction[];
  risks: ProcessRiskRow[];
}

export async function getProcess(tx: TenantTx, processId: string): Promise<ProcessDetail | null> {
  const rows = await tx.execute(sql`
    SELECT p.id, p.family, p.name, p.version, p.workflow, p.pilot_user_id,
           u.name AS pilot_name, p.kpis, p.covered_requirements, p.sipoc, p.interactions,
           (SELECT count(*) FROM process_risks pr WHERE pr.process_id = p.id) AS risk_count
    FROM processes p LEFT JOIN users u ON u.id = p.pilot_user_id
    WHERE p.id = ${processId}
  `);
  const list = rows as unknown as (RawProcess & { sipoc: unknown; interactions: unknown })[];
  if (list.length === 0) return null;
  const r = list[0]!;
  // La bande nette n'est pas stockée sur la table risks (elle dépend de
  // l'échelle) : on la recalcule via l'échelle active du tenant.
  const scale = (await getActiveScale(tx))?.scale ?? defaultRiskScale();
  const risks = (await tx.execute(sql`
    SELECT r.id, r.title, r.net_g, r.net_v
    FROM process_risks pr JOIN risks r ON r.id = pr.risk_id
    WHERE pr.process_id = ${processId}
    ORDER BY r.title
  `)) as unknown as { id: string; title: string; net_g: number | string; net_v: number | string }[];
  return {
    ...toSummary(r),
    sipoc: asJson<Sipoc>(r.sipoc, EMPTY_SIPOC),
    kpis: asJson<ProcessKpi[]>(r.kpis, []),
    coveredRequirements: asJson<ProcessRequirement[]>(r.covered_requirements, []),
    interactions: asJson<ProcessInteraction[]>(r.interactions, []),
    risks: risks.map((x) => ({ id: x.id, title: x.title, netBand: riskBand(Number(x.net_g), Number(x.net_v), scale) })),
  };
}
