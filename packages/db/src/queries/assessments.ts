import type { AssessmentItemStatus } from '@toron/core';
import { and, eq, inArray, sql } from 'drizzle-orm';

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
  /**
   * Exigences (par référence) qui entrent déjà exclues, avec leur
   * justification — ex. les moyens ReCyF réservés aux entités essentielles
   * pour une entité importante (core.recyfPreExclusions).
   */
  excluded?: { refs: readonly string[]; justification: string };
}

/**
 * Crée une campagne d'évaluation et pré-remplit un item « à évaluer » par
 * exigence feuille du référentiel (« non applicable » pour les exigences
 * pré-exclues). Renvoie l'id de la campagne.
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
  if (input.excluded && input.excluded.refs.length > 0) {
    await tx
      .update(schema.assessmentItems)
      .set({ status: 'non_applicable', soaIncluded: false, soaJustification: input.excluded.justification })
      .where(
        and(
          eq(schema.assessmentItems.assessmentId, assessmentId),
          inArray(
            schema.assessmentItems.requirementId,
            tx
              .select({ id: schema.requirements.id })
              .from(schema.requirements)
              .where(
                and(
                  eq(schema.requirements.frameworkId, input.frameworkId),
                  inArray(schema.requirements.refId, [...input.excluded.refs]),
                ),
              ),
          ),
        ),
      );
  }
  return assessmentId;
}

/**
 * Exigence ajoutée après le lancement d'une campagne (référentiel interne) :
 * elle entre « à évaluer » dans chaque campagne non clôturée du référentiel,
 * comme si elle avait existé à la création. Une campagne clôturée reste
 * figée. Renvoie le nombre de campagnes complétées.
 */
export async function addRequirementToOpenAssessments(
  tx: TenantTx,
  input: { tenantId: string; frameworkId: string; requirementId: string },
): Promise<number> {
  const rows = await tx.execute(sql`
    INSERT INTO assessment_items (tenant_id, assessment_id, requirement_id)
    SELECT ${input.tenantId}, a.id, ${input.requirementId}
    FROM assessments a
    WHERE a.framework_id = ${input.frameworkId} AND a.status <> 'cloturee'
    ON CONFLICT ON CONSTRAINT assessment_items_assessment_req_unique DO NOTHING
    RETURNING id
  `);
  return (rows as unknown as { id: string }[]).length;
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

export interface AssessmentItemContext {
  campaignStatus: string;
  frameworkCode: string;
  requirementRef: string;
  status: AssessmentItemStatus;
}

/**
 * Contexte d'un item avant écriture : statut de la campagne (une campagne
 * clôturée est figée), référentiel et référence de l'exigence (règles
 * d'exclusion), statut enregistré. null si l'exigence n'est pas dans la campagne.
 */
export async function getAssessmentItemContext(
  tx: TenantTx,
  assessmentId: string,
  requirementId: string,
): Promise<AssessmentItemContext | null> {
  const rows = await tx.execute(sql`
    SELECT a.status AS campaign_status, f.code AS framework_code, r.ref_id AS requirement_ref, ai.status
    FROM assessment_items ai
    JOIN assessments a ON a.id = ai.assessment_id
    JOIN frameworks f ON f.id = a.framework_id
    JOIN requirements r ON r.id = ai.requirement_id
    WHERE ai.assessment_id = ${assessmentId} AND ai.requirement_id = ${requirementId}
  `);
  const r = (rows as unknown as {
    campaign_status: string;
    framework_code: string;
    requirement_ref: string;
    status: AssessmentItemStatus;
  }[])[0];
  return r
    ? { campaignStatus: r.campaign_status, frameworkCode: r.framework_code, requirementRef: r.requirement_ref, status: r.status }
    : null;
}

/**
 * Action corrective déjà ouverte depuis cette campagne pour cette exigence
 * (origine + lien), ou null : un écart ne produit qu'une action ouverte. Une
 * action terminée alors que l'écart demeure (correction inefficace) n'empêche
 * pas d'en ouvrir une nouvelle.
 */
export async function findGapAction(
  tx: TenantTx,
  assessmentId: string,
  requirementId: string,
): Promise<string | null> {
  const rows = await tx.execute(sql`
    SELECT ac.id
    FROM actions ac
    JOIN action_links al ON al.action_id = ac.id
      AND al.target_type = 'requirement' AND al.target_id = ${requirementId}
    WHERE ac.origin_type = 'assessment' AND ac.origin_id = ${assessmentId}
      AND ac.status <> 'termine'
    ORDER BY ac.created_at
    LIMIT 1
  `);
  return (rows as unknown as { id: string }[])[0]?.id ?? null;
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

export interface SoaHeader {
  frameworkName: string;
  scopeName: string;
  entityName: string;
  campaignLabel: string;
}

/**
 * En-tête de la Déclaration d'applicabilité (référentiel, périmètre, entité).
 * Sans entité juridique déclarée, l'entité est l'organisation elle-même —
 * jamais le nom du périmètre.
 */
export async function getSoaHeader(tx: TenantTx, assessmentId: string): Promise<SoaHeader | null> {
  const rows = await tx.execute(sql`
    SELECT
      f.name AS framework_name,
      s.name AS scope_name,
      a.campaign_label,
      COALESCE(
        (SELECT le.name FROM legal_entities le WHERE le.tenant_id = a.tenant_id
           ORDER BY le.created_at LIMIT 1),
        t.name
      ) AS entity_name
    FROM assessments a
    JOIN frameworks f ON f.id = a.framework_id
    JOIN scopes s ON s.id = a.scope_id
    JOIN tenants t ON t.id = a.tenant_id
    WHERE a.id = ${assessmentId}
  `);
  const list = rows as unknown as {
    framework_name: string;
    scope_name: string;
    campaign_label: string;
    entity_name: string;
  }[];
  if (list.length === 0) return null;
  const r = list[0]!;
  return {
    frameworkName: r.framework_name,
    scopeName: r.scope_name,
    entityName: r.entity_name,
    campaignLabel: r.campaign_label,
  };
}

export interface MutualizedPeerRow {
  requirementId: string;
  requirementRef: string;
  frameworkId: string;
  frameworkCode: string;
  frameworkName: string;
  viaControlTitle: string;
  currentStatus: AssessmentItemStatus | null;
  campaignOpen: boolean;
}

/**
 * Pairs mutualisés d'une exigence : les exigences d'AUTRES référentiels
 * couvertes par un même contrôle, avec leur statut courant (campagne en
 * cours la plus récente qui les porte, comme la page du référentiel, à
 * défaut la dernière clôturée, ou null) et l'état de cette campagne : une
 * campagne clôturée est figée, rien n'y est héritable. Alimente la
 * suggestion d'héritage (core.suggestInheritedStatuses). Un pair par
 * exigence (contrôle arbitraire si plusieurs les relient).
 */
export async function getMutualizedPeers(
  tx: TenantTx,
  requirementId: string,
): Promise<MutualizedPeerRow[]> {
  const rows = await tx.execute(sql`
    SELECT DISTINCT ON (peer.id)
      peer.id AS requirement_id,
      peer.ref_id AS requirement_ref,
      pf.id AS framework_id,
      pf.code AS framework_code,
      pf.name AS framework_name,
      c.title AS via_control_title,
      latest.status AS current_status,
      COALESCE(latest.campaign_status = 'en_cours', false) AS campaign_open
    FROM control_requirements cr_src
    JOIN requirements src ON src.id = cr_src.requirement_id
    JOIN control_requirements cr_peer ON cr_peer.control_id = cr_src.control_id
    JOIN requirements peer ON peer.id = cr_peer.requirement_id
    JOIN frameworks pf ON pf.id = peer.framework_id
    JOIN controls c ON c.id = cr_src.control_id
    LEFT JOIN LATERAL (
      SELECT ai.status, a.status AS campaign_status
      FROM assessment_items ai
      JOIN assessments a ON a.id = ai.assessment_id
      WHERE ai.requirement_id = peer.id
      ORDER BY (a.status = 'en_cours') DESC, a.created_at DESC
      LIMIT 1
    ) latest ON true
    WHERE cr_src.requirement_id = ${requirementId}
      AND peer.framework_id <> src.framework_id
    ORDER BY peer.id, c.title
  `);
  return (rows as unknown as RawPeer[]).map((r) => ({
    requirementId: r.requirement_id,
    requirementRef: r.requirement_ref,
    frameworkId: r.framework_id,
    frameworkCode: r.framework_code,
    frameworkName: r.framework_name,
    viaControlTitle: r.via_control_title,
    currentStatus: r.current_status,
    campaignOpen: r.campaign_open,
  }));
}

interface RawPeer {
  requirement_id: string;
  requirement_ref: string;
  framework_id: string;
  framework_code: string;
  framework_name: string;
  via_control_title: string;
  current_status: AssessmentItemStatus | null;
  campaign_open: boolean;
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
