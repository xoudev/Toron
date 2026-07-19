import type { ReviewStatus } from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import { createAction } from './actions.ts';
import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès de la revue de direction (module 5.9, clause 9.3) ────
// Les décisions se convertissent en actions via le moteur COMMUN (origin
// 'review'). L'ordre du jour est calculé à l'affichage (getReviewCounts +
// métriques tableau de bord), non stocké. RLS active.

export interface CreateReviewInput {
  tenantId: string;
  title: string;
  scopeLabel?: string;
  heldAt?: string | null;
  nextReviewAt?: string | null;
}

export async function createReview(tx: TenantTx, input: CreateReviewInput): Promise<string> {
  const [row] = await tx
    .insert(schema.managementReviews)
    .values({
      tenantId: input.tenantId,
      title: input.title,
      scopeLabel: input.scopeLabel ?? 'SMSI + QMS',
      heldAt: input.heldAt ?? null,
      nextReviewAt: input.nextReviewAt ?? null,
    })
    .returning({ id: schema.managementReviews.id });
  return row!.id;
}

export async function setReviewStatus(tx: TenantTx, reviewId: string, status: ReviewStatus): Promise<number> {
  const u = await tx
    .update(schema.managementReviews)
    .set({ status })
    .where(eq(schema.managementReviews.id, reviewId))
    .returning({ id: schema.managementReviews.id });
  return u.length;
}

export async function addParticipant(
  tx: TenantTx,
  input: { tenantId: string; reviewId: string; userId: string },
): Promise<void> {
  await tx
    .insert(schema.reviewParticipants)
    .values({ tenantId: input.tenantId, reviewId: input.reviewId, userId: input.userId })
    .onConflictDoNothing();
}

export async function removeParticipant(tx: TenantTx, reviewId: string, userId: string): Promise<void> {
  await tx
    .delete(schema.reviewParticipants)
    .where(and(eq(schema.reviewParticipants.reviewId, reviewId), eq(schema.reviewParticipants.userId, userId)));
}

export async function addDecision(
  tx: TenantTx,
  input: { tenantId: string; reviewId: string; body: string },
): Promise<string> {
  const [row] = await tx
    .insert(schema.reviewDecisions)
    .values({ tenantId: input.tenantId, reviewId: input.reviewId, body: input.body })
    .returning({ id: schema.reviewDecisions.id });
  return row!.id;
}

/** Convertit une décision en action tracée (moteur commun, origin 'review'). */
export async function convertDecisionToAction(
  tx: TenantTx,
  input: { tenantId: string; decisionId: string; reviewId: string; title: string; ownerUserId: string },
): Promise<string> {
  const actionId = await createAction(tx, {
    tenantId: input.tenantId,
    title: input.title,
    originType: 'review',
    originId: input.reviewId,
    ownerUserId: input.ownerUserId,
    priority: 'p2',
  });
  await tx.update(schema.reviewDecisions).set({ actionId }).where(eq(schema.reviewDecisions.id, input.decisionId));
  return actionId;
}

export interface ReviewSummary {
  id: string;
  title: string;
  scopeLabel: string;
  status: ReviewStatus;
  heldAt: string | null;
  nextReviewAt: string | null;
  participantCount: number;
  decisionCount: number;
  actionCount: number;
}

interface RawReview {
  id: string;
  title: string;
  scope_label: string;
  status: ReviewStatus;
  held_at: string | null;
  next_review_at: string | null;
  participant_count: number | string;
  decision_count: number | string;
  action_count: number | string;
}

export async function listReviews(tx: TenantTx): Promise<ReviewSummary[]> {
  const rows = await tx.execute(sql`
    SELECT r.id, r.title, r.scope_label, r.status,
           r.held_at::text AS held_at, r.next_review_at::text AS next_review_at,
           (SELECT count(*) FROM review_participants p WHERE p.review_id = r.id) AS participant_count,
           (SELECT count(*) FROM review_decisions d WHERE d.review_id = r.id) AS decision_count,
           (SELECT count(*) FROM review_decisions d WHERE d.review_id = r.id AND d.action_id IS NOT NULL) AS action_count
    FROM management_reviews r
    ORDER BY (r.status = 'close'), r.held_at DESC NULLS LAST, r.created_at DESC
  `);
  return (rows as unknown as RawReview[]).map((r) => ({
    id: r.id,
    title: r.title,
    scopeLabel: r.scope_label,
    status: r.status,
    heldAt: r.held_at,
    nextReviewAt: r.next_review_at,
    participantCount: Number(r.participant_count),
    decisionCount: Number(r.decision_count),
    actionCount: Number(r.action_count),
  }));
}

export interface ReviewParticipantRow {
  userId: string;
  name: string;
}
export interface ReviewDecisionRow {
  id: string;
  body: string;
  actionId: string | null;
  createdAt: string;
}
export interface ReviewDetail extends ReviewSummary {
  participants: ReviewParticipantRow[];
  decisions: ReviewDecisionRow[];
}

export async function getReview(tx: TenantTx, reviewId: string): Promise<ReviewDetail | null> {
  const head = await listOne(tx, reviewId);
  if (!head) return null;
  const participants = (await tx.execute(sql`
    SELECT p.user_id, u.name
    FROM review_participants p JOIN users u ON u.id = p.user_id
    WHERE p.review_id = ${reviewId}
    ORDER BY u.name
  `)) as unknown as { user_id: string; name: string }[];
  const decisions = (await tx.execute(sql`
    SELECT id, body, action_id, created_at::text AS created_at
    FROM review_decisions WHERE review_id = ${reviewId}
    ORDER BY created_at
  `)) as unknown as { id: string; body: string; action_id: string | null; created_at: string }[];
  return {
    ...head,
    participants: participants.map((p) => ({ userId: p.user_id, name: p.name })),
    decisions: decisions.map((d) => ({ id: d.id, body: d.body, actionId: d.action_id, createdAt: d.created_at })),
  };
}

async function listOne(tx: TenantTx, reviewId: string): Promise<ReviewSummary | null> {
  const rows = await tx.execute(sql`
    SELECT r.id, r.title, r.scope_label, r.status,
           r.held_at::text AS held_at, r.next_review_at::text AS next_review_at,
           (SELECT count(*) FROM review_participants p WHERE p.review_id = r.id) AS participant_count,
           (SELECT count(*) FROM review_decisions d WHERE d.review_id = r.id) AS decision_count,
           (SELECT count(*) FROM review_decisions d WHERE d.review_id = r.id AND d.action_id IS NOT NULL) AS action_count
    FROM management_reviews r WHERE r.id = ${reviewId}
  `);
  const list = rows as unknown as RawReview[];
  if (list.length === 0) return null;
  const r = list[0]!;
  return {
    id: r.id,
    title: r.title,
    scopeLabel: r.scope_label,
    status: r.status,
    heldAt: r.held_at,
    nextReviewAt: r.next_review_at,
    participantCount: Number(r.participant_count),
    decisionCount: Number(r.decision_count),
    actionCount: Number(r.action_count),
  };
}

/** Nom de l'entité juridique principale du tenant (pour l'en-tête du PV). */
export async function getReviewEntityName(tx: TenantTx): Promise<string | null> {
  const rows = await tx.execute(sql`
    SELECT name FROM legal_entities ORDER BY created_at LIMIT 1
  `);
  const list = rows as unknown as { name: string }[];
  return list.length > 0 ? list[0]!.name : null;
}

export interface ReviewCounts {
  auditsInProgress: number;
  auditsClosed: number;
  ncOpen: number;
  ncInEffectivenessCheck: number;
  incidentsOpen: number;
}

/** Compteurs complémentaires (audits, NC, incidents) pour l'ordre du jour 9.3.2. */
export async function getReviewCounts(tx: TenantTx): Promise<ReviewCounts> {
  const rows = await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM audits WHERE status = 'en_cours') AS audits_in_progress,
      (SELECT count(*) FROM audits WHERE status = 'clos') AS audits_closed,
      (SELECT count(*) FROM nonconformities WHERE status IN ('ouverte','en_traitement','rouverte')) AS nc_open,
      (SELECT count(*) FROM nonconformities WHERE status = 'cloturee_a_verifier') AS nc_in_check,
      (SELECT count(*) FROM incidents WHERE status IN ('ouvert','qualifie')) AS incidents_open
  `);
  const r = (rows as unknown as {
    audits_in_progress: number | string;
    audits_closed: number | string;
    nc_open: number | string;
    nc_in_check: number | string;
    incidents_open: number | string;
  }[])[0]!;
  return {
    auditsInProgress: Number(r.audits_in_progress),
    auditsClosed: Number(r.audits_closed),
    ncOpen: Number(r.nc_open),
    ncInEffectivenessCheck: Number(r.nc_in_check),
    incidentsOpen: Number(r.incidents_open),
  };
}
