import {
  controlReviewState,
  nextControlReview,
  type ControlReviewMethod,
  type ControlReviewResult,
  type ControlReviewState,
  type ExceptionStatus,
  type ReviewFrequency,
} from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Bibliothèque des contrôles et revues d'efficacité (migration 0033) ──
// Opère sur une TenantTx (RLS active). L'échéance et l'état de suivi sont
// calculés par @toron/core à partir de la fréquence et de la dernière revue.

export interface ControlLibraryRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  ownerUserId: string | null;
  ownerName: string | null;
  frequency: ReviewFrequency | null;
  createdOn: string;
  frameworkCodes: string[];
  mappedRequirementCount: number;
  mutualized: boolean;
  lastReviewedOn: string | null;
  lastResult: ControlReviewResult | null;
  reviewCount: number;
  nextReviewOn: string | null;
  reviewState: ControlReviewState;
  openExceptionCount: number;
  riskCount: number;
  evidenceCount: number;
}

interface RawLibrary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  owner_user_id: string | null;
  owner_name: string | null;
  review_frequency: ReviewFrequency | null;
  created_on: string;
  review_start_on: string;
  framework_codes: string[];
  mapped_requirement_count: number | string;
  last_reviewed_on: string | null;
  last_result: ControlReviewResult | null;
  review_count: number | string;
  open_exception_count: number | string;
  risk_count: number | string;
  evidence_count: number | string;
}

/** Contrôles du tenant avec leur couverture, leur dernière revue et l'échéance de la suivante. */
export async function listControlLibrary(tx: TenantTx, today: string): Promise<ControlLibraryRow[]> {
  const rows = (await tx.execute(sql`
    SELECT c.id, c.title, c.description, c.status::text AS status, c.owner_user_id, o.name AS owner_name,
           c.review_frequency::text AS review_frequency, c.created_at::date::text AS created_on,
           coalesce(c.activated_on, c.created_at::date)::text AS review_start_on,
           coalesce(array_agg(DISTINCT f.code) FILTER (WHERE f.code IS NOT NULL), '{}') AS framework_codes,
           count(DISTINCT cr.requirement_id) AS mapped_requirement_count,
           lr.reviewed_on::text AS last_reviewed_on, lr.result AS last_result,
           (SELECT count(*) FROM control_reviews x WHERE x.control_id = c.id) AS review_count,
           (SELECT count(*) FROM policy_exceptions e
             WHERE e.control_id = c.id AND e.status IN ('demandee', 'approuvee')
               AND NOT (e.expires_on < current_date AND EXISTS (
                 SELECT 1 FROM policy_exceptions n WHERE n.renewed_from_id = e.id AND n.status = 'approuvee'))) AS open_exception_count,
           (SELECT count(*) FROM risk_controls rc WHERE rc.control_id = c.id) AS risk_count,
           (SELECT count(*) FROM evidence_links el JOIN evidences ev ON ev.id = el.evidence_id
             WHERE el.target_type = 'control' AND el.target_id = c.id AND ev.superseded_by IS NULL) AS evidence_count
    FROM controls c
    LEFT JOIN users o ON o.id = c.owner_user_id
    LEFT JOIN control_requirements cr ON cr.control_id = c.id
    LEFT JOIN requirements r ON r.id = cr.requirement_id
    LEFT JOIN frameworks f ON f.id = r.framework_id
    LEFT JOIN LATERAL (
      SELECT x.reviewed_on, x.result FROM control_reviews x
      WHERE x.control_id = c.id ORDER BY x.reviewed_on DESC, x.created_at DESC LIMIT 1
    ) lr ON true
    GROUP BY c.id, o.name, lr.reviewed_on, lr.result
    ORDER BY c.title
  `)) as unknown as RawLibrary[];

  return rows.map((r) => {
    // Jamais revu : la première revue part de l'activation (ou de la création).
    const schedule = { frequency: r.review_frequency, lastReviewedOn: r.last_reviewed_on, createdOn: r.review_start_on };
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      ownerUserId: r.owner_user_id,
      ownerName: r.owner_name,
      frequency: r.review_frequency,
      createdOn: r.created_on,
      frameworkCodes: r.framework_codes,
      mappedRequirementCount: Number(r.mapped_requirement_count),
      mutualized: r.framework_codes.length > 1,
      lastReviewedOn: r.last_reviewed_on,
      lastResult: r.last_result,
      reviewCount: Number(r.review_count),
      nextReviewOn: nextControlReview(schedule),
      reviewState: controlReviewState(schedule, today),
      openExceptionCount: Number(r.open_exception_count),
      riskCount: Number(r.risk_count),
      evidenceCount: Number(r.evidence_count),
    };
  });
}

export interface ControlReviewRow {
  id: string;
  reviewedOn: string;
  reviewerUserId: string;
  reviewerName: string | null;
  method: ControlReviewMethod;
  result: ControlReviewResult;
  observations: string | null;
  evidenceId: string | null;
  evidenceTitle: string | null;
}

export interface ControlDetail {
  requirements: { frameworkCode: string; frameworkName: string; ref: string; title: string }[];
  evidences: { id: string; title: string; collectedAt: string; validUntil: string | null }[];
  risks: { id: string; title: string }[];
  exceptions: { id: string; title: string; status: ExceptionStatus; expiresOn: string }[];
  reviews: ControlReviewRow[];
}

/** Ce qui gravite autour d'un contrôle : exigences couvertes, preuves, risques, dérogations, revues. Null s'il n'existe pas. */
export async function getControlDetail(tx: TenantTx, controlId: string): Promise<ControlDetail | null> {
  if (!(await getControlRef(tx, controlId))) return null;
  const requirements = (await tx.execute(sql`
    SELECT f.code AS framework_code, f.name AS framework_name, r.ref_id, r.title_internal
    FROM control_requirements cr
    JOIN requirements r ON r.id = cr.requirement_id
    JOIN frameworks f ON f.id = r.framework_id
    WHERE cr.control_id = ${controlId}
    ORDER BY f.name, r.sort_order
  `)) as unknown as { framework_code: string; framework_name: string; ref_id: string; title_internal: string }[];
  const evidences = (await tx.execute(sql`
    SELECT ev.id, ev.title, ev.collected_at::text AS collected_at, ev.valid_until::text AS valid_until
    FROM evidence_links el JOIN evidences ev ON ev.id = el.evidence_id
    WHERE el.target_type = 'control' AND el.target_id = ${controlId} AND ev.superseded_by IS NULL
    ORDER BY ev.collected_at DESC
  `)) as unknown as { id: string; title: string; collected_at: string; valid_until: string | null }[];
  const risks = (await tx.execute(sql`
    SELECT r.id, r.title FROM risk_controls rc JOIN risks r ON r.id = rc.risk_id
    WHERE rc.control_id = ${controlId} ORDER BY r.title
  `)) as unknown as { id: string; title: string }[];
  const exceptions = (await tx.execute(sql`
    SELECT e.id, e.title, e.status, e.expires_on::text AS expires_on
    FROM policy_exceptions e WHERE e.control_id = ${controlId} AND e.status IN ('demandee', 'approuvee')
    ORDER BY e.expires_on
  `)) as unknown as { id: string; title: string; status: ExceptionStatus; expires_on: string }[];
  return {
    requirements: requirements.map((r) => ({ frameworkCode: r.framework_code, frameworkName: r.framework_name, ref: r.ref_id, title: r.title_internal })),
    evidences: evidences.map((e) => ({ id: e.id, title: e.title, collectedAt: e.collected_at, validUntil: e.valid_until })),
    risks,
    exceptions: exceptions.map((e) => ({ id: e.id, title: e.title, status: e.status, expiresOn: e.expires_on })),
    reviews: await listControlReviews(tx, controlId),
  };
}

/** Historique des revues d'un contrôle, la plus récente d'abord. */
export async function listControlReviews(tx: TenantTx, controlId: string): Promise<ControlReviewRow[]> {
  const rows = (await tx.execute(sql`
    SELECT x.id, x.reviewed_on::text AS reviewed_on, x.reviewer_user_id, u.name AS reviewer_name, x.method, x.result,
           x.observations, x.evidence_id, ev.title AS evidence_title
    FROM control_reviews x
    LEFT JOIN users u ON u.id = x.reviewer_user_id
    LEFT JOIN evidences ev ON ev.id = x.evidence_id
    WHERE x.control_id = ${controlId}
    ORDER BY x.reviewed_on DESC, x.created_at DESC
  `)) as unknown as {
    id: string; reviewed_on: string; reviewer_user_id: string; reviewer_name: string | null; method: ControlReviewMethod;
    result: ControlReviewResult; observations: string | null; evidence_id: string | null; evidence_title: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    reviewedOn: r.reviewed_on,
    reviewerUserId: r.reviewer_user_id,
    reviewerName: r.reviewer_name,
    method: r.method,
    result: r.result,
    observations: r.observations,
    evidenceId: r.evidence_id,
    evidenceTitle: r.evidence_title,
  }));
}

export interface ControlRef {
  id: string;
  title: string;
  ownerUserId: string | null;
}

export async function getControlRef(tx: TenantTx, controlId: string): Promise<ControlRef | null> {
  const [row] = await tx
    .select({ id: schema.controls.id, title: schema.controls.title, ownerUserId: schema.controls.ownerUserId })
    .from(schema.controls)
    .where(eq(schema.controls.id, controlId));
  return row ?? null;
}

/** Consigne une revue d'efficacité. Renvoie son id. */
export async function createControlReview(
  tx: TenantTx,
  input: {
    tenantId: string; controlId: string; reviewedOn: string; reviewerUserId: string;
    method: ControlReviewMethod; result: ControlReviewResult; observations: string | null; evidenceId: string | null;
  },
): Promise<string> {
  const [row] = await tx.insert(schema.controlReviews).values(input).returning({ id: schema.controlReviews.id });
  return row!.id;
}

export interface UpdateControlInput {
  controlId: string;
  title: string;
  description: string | null;
  ownerUserId: string | null;
  reviewFrequency: ReviewFrequency | null;
  status: 'brouillon' | 'actif' | 'archive';
}

/** Met à jour la fiche d'un contrôle. Renvoie le nombre de lignes. */
export async function updateControl(tx: TenantTx, input: UpdateControlInput): Promise<number> {
  const updated = await tx
    .update(schema.controls)
    .set({
      title: input.title,
      description: input.description,
      ownerUserId: input.ownerUserId,
      reviewFrequency: input.reviewFrequency,
      status: input.status,
      // Passage au statut actif : date d'activation, point de départ de la première revue.
      activatedOn: sql`CASE WHEN ${schema.controls.status} <> 'actif' AND ${input.status} = 'actif'
                            THEN (now() AT TIME ZONE 'Europe/Paris')::date ELSE ${schema.controls.activatedOn} END`,
    })
    .where(eq(schema.controls.id, input.controlId))
    .returning({ id: schema.controls.id });
  return updated.length;
}
