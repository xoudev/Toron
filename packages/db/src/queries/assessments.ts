import type { AssessmentItemStatus } from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des évaluations & SoA (module 5.3) ──────────────────
// Opère sur une TenantTx : contexte tenant posé par withTenant(), RLS
// active. Les campagnes portent sur les exigences FEUILLES d'un référentiel
// (celles qu'on évalue réellement : contrôles Annexe A, sous-clauses,
// moyens ReCyF), pas les nœuds de regroupement.

export interface CreateAssessmentInput {
  tenantId: string;
  frameworkId: string;
  scopeId: string;
  campaignLabel: string;
}

/**
 * Crée une campagne d'évaluation et pré-remplit un item « à évaluer » par
 * exigence feuille du référentiel. Renvoie l'id de la campagne.
 */
export async function createAssessment(tx: TenantTx, input: CreateAssessmentInput): Promise<string> {
  const [row] = await tx
    .insert(schema.assessments)
    .values({
      tenantId: input.tenantId,
      frameworkId: input.frameworkId,
      scopeId: input.scopeId,
      campaignLabel: input.campaignLabel,
      status: 'en_cours',
      startedAt: new Date(),
    })
    .returning({ id: schema.assessments.id });
  const assessmentId = row!.id;

  // Un item par exigence feuille (aucune exigence enfant du référentiel).
  await tx.execute(sql`
    INSERT INTO assessment_items (tenant_id, assessment_id, requirement_id)
    SELECT ${input.tenantId}, ${assessmentId}, r.id
    FROM requirements r
    WHERE r.framework_id = ${input.frameworkId}
      AND NOT EXISTS (SELECT 1 FROM requirements c WHERE c.parent_id = r.id)
  `);
  return assessmentId;
}

export interface AssessmentSummary {
  id: string;
  frameworkId: string;
  scopeId: string;
  campaignLabel: string;
  status: string;
  startedAt: Date | null;
  closedAt: Date | null;
  itemCount: number;
}

/** Liste les campagnes du tenant, éventuellement filtrées par référentiel. */
export async function listAssessments(
  tx: TenantTx,
  frameworkId?: string,
): Promise<AssessmentSummary[]> {
  const rows = await tx.execute(sql`
    SELECT
      a.id, a.framework_id, a.scope_id, a.campaign_label, a.status,
      a.started_at, a.closed_at,
      (SELECT count(*) FROM assessment_items ai WHERE ai.assessment_id = a.id) AS item_count
    FROM assessments a
    ${frameworkId ? sql`WHERE a.framework_id = ${frameworkId}` : sql``}
    ORDER BY a.created_at DESC
  `);
  return (rows as unknown as RawAssessment[]).map((r) => ({
    id: r.id,
    frameworkId: r.framework_id,
    scopeId: r.scope_id,
    campaignLabel: r.campaign_label,
    status: r.status,
    startedAt: r.started_at,
    closedAt: r.closed_at,
    itemCount: Number(r.item_count),
  }));
}

interface RawAssessment {
  id: string;
  framework_id: string;
  scope_id: string;
  campaign_label: string;
  status: string;
  started_at: Date | null;
  closed_at: Date | null;
  item_count: string | number;
}

export interface AssessmentItemRow {
  id: string;
  requirementId: string;
  requirementRef: string;
  requirementTitle: string;
  status: AssessmentItemStatus;
  statement: string | null;
  soaIncluded: boolean;
  soaJustification: string | null;
  assessedAt: Date | null;
}

/** Items d'une campagne, joints à leur exigence, ordonnés par sort_order. */
export async function getAssessmentItems(
  tx: TenantTx,
  assessmentId: string,
): Promise<AssessmentItemRow[]> {
  const rows = await tx.execute(sql`
    SELECT
      ai.id, ai.requirement_id, r.ref_id AS requirement_ref, r.title_internal AS requirement_title,
      ai.status, ai.statement, ai.soa_included, ai.soa_justification, ai.assessed_at
    FROM assessment_items ai
    JOIN requirements r ON r.id = ai.requirement_id
    WHERE ai.assessment_id = ${assessmentId}
    ORDER BY r.sort_order
  `);
  return (rows as unknown as RawItem[]).map((r) => ({
    id: r.id,
    requirementId: r.requirement_id,
    requirementRef: r.requirement_ref,
    requirementTitle: r.requirement_title,
    status: r.status,
    statement: r.statement,
    soaIncluded: r.soa_included,
    soaJustification: r.soa_justification,
    assessedAt: r.assessed_at,
  }));
}

interface RawItem {
  id: string;
  requirement_id: string;
  requirement_ref: string;
  requirement_title: string;
  status: AssessmentItemStatus;
  statement: string | null;
  soa_included: boolean;
  soa_justification: string | null;
  assessed_at: Date | null;
}

export interface SetItemStatusInput {
  assessmentId: string;
  requirementId: string;
  status: AssessmentItemStatus;
  statement?: string | null;
  soaIncluded?: boolean;
  soaJustification?: string | null;
  assessedBy: string;
}

/**
 * Fixe le statut d'une exigence dans une campagne. La contrainte CHECK en
 * base refuse « non applicable » sans justification (RM §5.3) : l'appelant
 * valide en amont (core.isSoaItemValid) et capture l'erreur DB en dernier
 * ressort. Renvoie le nombre de lignes affectées (0 si l'item n'existe pas).
 */
export async function setAssessmentItemStatus(
  tx: TenantTx,
  input: SetItemStatusInput,
): Promise<number> {
  const updated = await tx
    .update(schema.assessmentItems)
    .set({
      status: input.status,
      statement: input.statement ?? null,
      soaIncluded: input.soaIncluded ?? true,
      soaJustification: input.soaJustification ?? null,
      assessedBy: input.assessedBy,
      assessedAt: new Date(),
    })
    .where(
      and(
        eq(schema.assessmentItems.assessmentId, input.assessmentId),
        eq(schema.assessmentItems.requirementId, input.requirementId),
      ),
    )
    .returning({ id: schema.assessmentItems.id });
  return updated.length;
}

/** Clôture une campagne (gèle son état ; l'historique reste dans les campagnes). */
export async function closeAssessment(tx: TenantTx, assessmentId: string): Promise<number> {
  const updated = await tx
    .update(schema.assessments)
    .set({ status: 'cloturee', closedAt: new Date() })
    .where(eq(schema.assessments.id, assessmentId))
    .returning({ id: schema.assessments.id });
  return updated.length;
}
