import type { AuditStatus, FindingType } from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import { createAction } from './actions.ts';
import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des audits internes (module 5.8) ────────────────────
// Les constats se convertissent en actions via le moteur COMMUN (origin
// 'finding'). RLS active.

export interface CreateAuditInput {
  tenantId: string;
  title: string;
  frameworkId?: string | null;
  scopeId?: string | null;
  plannedAt?: string | null;
  leadAuditor?: string | null;
}

export async function createAudit(tx: TenantTx, input: CreateAuditInput): Promise<string> {
  const [row] = await tx
    .insert(schema.audits)
    .values({
      tenantId: input.tenantId,
      title: input.title,
      frameworkId: input.frameworkId ?? null,
      scopeId: input.scopeId ?? null,
      plannedAt: input.plannedAt ?? null,
      leadAuditor: input.leadAuditor ?? null,
    })
    .returning({ id: schema.audits.id });
  return row!.id;
}

export async function setAuditStatus(tx: TenantTx, auditId: string, status: AuditStatus): Promise<number> {
  const u = await tx.update(schema.audits).set({ status }).where(eq(schema.audits.id, auditId)).returning({ id: schema.audits.id });
  return u.length;
}

export async function addFinding(
  tx: TenantTx,
  input: { tenantId: string; auditId: string; requirementRef?: string | null; type: FindingType; description: string },
): Promise<string> {
  const [row] = await tx
    .insert(schema.auditFindings)
    .values({ tenantId: input.tenantId, auditId: input.auditId, requirementRef: input.requirementRef ?? null, type: input.type, description: input.description })
    .returning({ id: schema.auditFindings.id });
  return row!.id;
}

/** Convertit un constat en action corrective (moteur commun, origin 'finding'). */
export async function convertFindingToAction(
  tx: TenantTx,
  input: { tenantId: string; findingId: string; auditId: string; title: string; ownerUserId: string },
): Promise<string> {
  const actionId = await createAction(tx, {
    tenantId: input.tenantId,
    title: input.title,
    originType: 'finding',
    originId: input.auditId,
    ownerUserId: input.ownerUserId,
    priority: 'p2',
  });
  await tx.update(schema.auditFindings).set({ actionId }).where(eq(schema.auditFindings.id, input.findingId));
  return actionId;
}

export interface AuditSummary {
  id: string;
  title: string;
  frameworkName: string | null;
  scopeName: string | null;
  status: AuditStatus;
  plannedAt: string | null;
  leadName: string | null;
  findingCount: number;
  ncCount: number;
}

interface RawAudit {
  id: string;
  title: string;
  framework_name: string | null;
  scope_name: string | null;
  status: AuditStatus;
  planned_at: string | null;
  lead_name: string | null;
  finding_count: number | string;
  nc_count: number | string;
}

export async function listAudits(tx: TenantTx): Promise<AuditSummary[]> {
  const rows = await tx.execute(sql`
    SELECT a.id, a.title, f.name AS framework_name, s.name AS scope_name, a.status,
           a.planned_at::text AS planned_at, u.name AS lead_name,
           (SELECT count(*) FROM audit_findings af WHERE af.audit_id = a.id) AS finding_count,
           (SELECT count(*) FROM audit_findings af WHERE af.audit_id = a.id AND af.type IN ('nc_mineure','nc_majeure')) AS nc_count
    FROM audits a
    LEFT JOIN frameworks f ON f.id = a.framework_id
    LEFT JOIN scopes s ON s.id = a.scope_id
    LEFT JOIN users u ON u.id = a.lead_auditor
    ORDER BY (a.status = 'clos'), a.planned_at DESC NULLS LAST
  `);
  return (rows as unknown as RawAudit[]).map((r) => ({
    id: r.id, title: r.title, frameworkName: r.framework_name, scopeName: r.scope_name,
    status: r.status, plannedAt: r.planned_at, leadName: r.lead_name,
    findingCount: Number(r.finding_count), ncCount: Number(r.nc_count),
  }));
}

export interface AuditFindingRow {
  id: string;
  requirementRef: string | null;
  type: FindingType;
  description: string;
  actionId: string | null;
}
export interface AuditDetail extends AuditSummary {
  findings: AuditFindingRow[];
}

export async function getAudit(tx: TenantTx, auditId: string): Promise<AuditDetail | null> {
  const base = (await listAudits(tx)).find((a) => a.id === auditId);
  if (!base) return null;
  const rows = (await tx.execute(sql`
    SELECT id, requirement_ref, type, description, action_id FROM audit_findings WHERE audit_id = ${auditId} ORDER BY created_at
  `)) as unknown as { id: string; requirement_ref: string | null; type: FindingType; description: string; action_id: string | null }[];
  return { ...base, findings: rows.map((r) => ({ id: r.id, requirementRef: r.requirement_ref, type: r.type, description: r.description, actionId: r.action_id })) };
}
