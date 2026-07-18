import {
  freshnessRank,
  freshnessState,
  type EvidenceRecurrence,
  type EvidenceType,
  type FreshnessState,
} from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès du coffre de preuves (module 5.7) ───────────────────
// RLS active. SHA-256 calculé à l'ingestion (par l'appelant). La fraîcheur
// et le tri « expirées d'abord » sont calculés par @toron/core.

export type EvidenceTarget = 'requirement' | 'control';

export interface CreateEvidenceInput {
  tenantId: string;
  title: string;
  type: EvidenceType;
  fileName?: string | null;
  content?: Buffer | null;
  sha256: string;
  collectedAt: string;
  validUntil?: string | null;
  recurrence: EvidenceRecurrence;
  collectorUserId?: string | null;
  links?: { targetType: EvidenceTarget; targetId: string }[];
}

export async function createEvidence(tx: TenantTx, input: CreateEvidenceInput): Promise<string> {
  const [row] = await tx
    .insert(schema.evidences)
    .values({
      tenantId: input.tenantId,
      title: input.title,
      type: input.type,
      fileName: input.fileName ?? null,
      content: input.content ?? null,
      sha256: input.sha256,
      collectedAt: input.collectedAt,
      validUntil: input.validUntil ?? null,
      recurrence: input.recurrence,
      collectorUserId: input.collectorUserId ?? null,
    })
    .returning({ id: schema.evidences.id });
  const evidenceId = row!.id;
  for (const link of input.links ?? []) {
    await tx
      .insert(schema.evidenceLinks)
      .values({
        tenantId: input.tenantId,
        evidenceId,
        targetType: link.targetType,
        targetId: link.targetId,
      })
      .onConflictDoNothing();
  }
  return evidenceId;
}

export interface EvidenceSummary {
  id: string;
  title: string;
  type: EvidenceType;
  sha256: string;
  fileName: string | null;
  hasContent: boolean;
  collectedAt: string;
  validUntil: string | null;
  recurrence: EvidenceRecurrence;
  collectorName: string | null;
  freshness: FreshnessState;
  linkCount: number;
}

interface RawEvidence {
  id: string;
  title: string;
  type: EvidenceType;
  sha256: string;
  file_name: string | null;
  has_content: boolean;
  collected_at: string;
  valid_until: string | null;
  recurrence: EvidenceRecurrence;
  collector_name: string | null;
  link_count: number | string;
}

/** Preuves du tenant, triées « expirées d'abord » puis par échéance croissante. */
export async function listEvidences(tx: TenantTx): Promise<EvidenceSummary[]> {
  const rows = await tx.execute(sql`
    SELECT e.id, e.title, e.type, e.sha256, e.file_name, (e.content IS NOT NULL) AS has_content,
           e.collected_at::text AS collected_at, e.valid_until::text AS valid_until,
           e.recurrence, u.name AS collector_name,
           (SELECT count(*) FROM evidence_links el WHERE el.evidence_id = e.id) AS link_count
    FROM evidences e LEFT JOIN users u ON u.id = e.collector_user_id
  `);
  const now = new Date();
  const list = (rows as unknown as RawEvidence[]).map((r) => {
    const freshness = freshnessState(r.valid_until ? new Date(r.valid_until) : null, now);
    return {
      id: r.id,
      title: r.title,
      type: r.type,
      sha256: r.sha256,
      fileName: r.file_name,
      hasContent: r.has_content,
      collectedAt: r.collected_at,
      validUntil: r.valid_until,
      recurrence: r.recurrence,
      collectorName: r.collector_name,
      freshness,
      linkCount: Number(r.link_count),
    };
  });
  return list.sort((a, b) => {
    const fr = freshnessRank(a.freshness) - freshnessRank(b.freshness);
    if (fr !== 0) return fr;
    return (a.validUntil ?? '9999').localeCompare(b.validUntil ?? '9999');
  });
}

export interface EvidenceContent {
  content: Buffer;
  fileName: string | null;
}

export async function getEvidenceContent(
  tx: TenantTx,
  evidenceId: string,
): Promise<EvidenceContent | null> {
  const [row] = await tx
    .select({ content: schema.evidences.content, fileName: schema.evidences.fileName })
    .from(schema.evidences)
    .where(eq(schema.evidences.id, evidenceId));
  if (!row || !row.content) return null;
  return { content: row.content, fileName: row.fileName };
}

// ── Liaisons ────────────────────────────────────────────────────────────
export async function linkEvidence(
  tx: TenantTx,
  input: { tenantId: string; evidenceId: string; targetType: EvidenceTarget; targetId: string },
): Promise<void> {
  await tx
    .insert(schema.evidenceLinks)
    .values({
      tenantId: input.tenantId,
      evidenceId: input.evidenceId,
      targetType: input.targetType,
      targetId: input.targetId,
    })
    .onConflictDoNothing();
}

export async function unlinkEvidence(
  tx: TenantTx,
  input: { evidenceId: string; targetType: EvidenceTarget; targetId: string },
): Promise<number> {
  const deleted = await tx
    .delete(schema.evidenceLinks)
    .where(
      and(
        eq(schema.evidenceLinks.evidenceId, input.evidenceId),
        eq(schema.evidenceLinks.targetType, input.targetType),
        eq(schema.evidenceLinks.targetId, input.targetId),
      ),
    )
    .returning({ evidenceId: schema.evidenceLinks.evidenceId });
  return deleted.length;
}

export interface EvidenceLinkRow {
  targetType: EvidenceTarget;
  targetId: string;
  label: string;
}

export async function listEvidenceLinks(tx: TenantTx, evidenceId: string): Promise<EvidenceLinkRow[]> {
  const rows = await tx.execute(sql`
    SELECT el.target_type, el.target_id,
      COALESCE(r.ref_id, ct.title, el.target_id::text) AS label
    FROM evidence_links el
    LEFT JOIN requirements r ON el.target_type = 'requirement' AND r.id = el.target_id
    LEFT JOIN controls ct ON el.target_type = 'control' AND ct.id = el.target_id
    WHERE el.evidence_id = ${evidenceId}
  `);
  return (
    rows as unknown as { target_type: EvidenceTarget; target_id: string; label: string }[]
  ).map((r) => ({ targetType: r.target_type, targetId: r.target_id, label: r.label }));
}

export interface CoveringEvidence {
  evidenceId: string;
  title: string;
  freshness: FreshnessState;
  viaControl: boolean;
}

/**
 * Preuves couvrant une exigence — directement liées OU via un contrôle mappé
 * sur l'exigence (CA §5.7 : une preuve liée à un contrôle mutualisé apparaît
 * sur tous les référentiels concernés). La fraîcheur est calculée par le cœur.
 */
export async function listEvidencesCoveringRequirement(
  tx: TenantTx,
  requirementId: string,
): Promise<CoveringEvidence[]> {
  const rows = await tx.execute(sql`
    SELECT DISTINCT ON (e.id) e.id, e.title, e.valid_until::text AS valid_until,
      bool_or(el.target_type = 'control') AS via_control
    FROM evidences e
    JOIN evidence_links el ON el.evidence_id = e.id
    LEFT JOIN control_requirements cr
      ON el.target_type = 'control' AND cr.control_id = el.target_id
    WHERE (el.target_type = 'requirement' AND el.target_id = ${requirementId})
       OR (el.target_type = 'control' AND cr.requirement_id = ${requirementId})
    GROUP BY e.id, e.title, e.valid_until
    ORDER BY e.id
  `);
  const now = new Date();
  return (
    rows as unknown as { id: string; title: string; valid_until: string | null; via_control: boolean }[]
  ).map((r) => ({
    evidenceId: r.id,
    title: r.title,
    freshness: freshnessState(r.valid_until ? new Date(r.valid_until) : null, now),
    viaControl: r.via_control,
  }));
}

// ── Journal des accès (append-only) ─────────────────────────────────────
export async function logAccess(
  tx: TenantTx,
  input: { tenantId: string; evidenceId: string; userId: string; kind: 'consultation' | 'telechargement' },
): Promise<void> {
  await tx.insert(schema.evidenceAccessLog).values({
    tenantId: input.tenantId,
    evidenceId: input.evidenceId,
    userId: input.userId,
    kind: input.kind,
  });
}

export interface AccessLogRow {
  userName: string | null;
  kind: string;
  at: Date;
}

export async function listAccessLog(tx: TenantTx, evidenceId: string): Promise<AccessLogRow[]> {
  const rows = await tx.execute(sql`
    SELECT u.name AS user_name, a.kind, a.at::text AS at
    FROM evidence_access_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.evidence_id = ${evidenceId}
    ORDER BY a.at DESC LIMIT 50
  `);
  return (rows as unknown as { user_name: string | null; kind: string; at: string }[]).map((r) => ({
    userName: r.user_name,
    kind: r.kind,
    at: new Date(r.at),
  }));
}
