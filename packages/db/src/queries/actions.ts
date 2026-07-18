import {
  effectiveActionStatus,
  type ActionEffectiveStatus,
  type ActionOrigin,
  type ActionPriority,
  type ActionStatus,
} from '@toron/core';
import { and, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès du plan d'action unifié (module 5.5) ────────────────
// Opère sur une TenantTx (RLS active). Le statut « en_retard » est calculé
// par @toron/core à partir de l'échéance — jamais lu ni écrit en base.

export type ActionLinkTarget = 'requirement' | 'control';

export interface CreateActionInput {
  tenantId: string;
  title: string;
  description?: string | null;
  originType: ActionOrigin;
  originId?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  priority?: ActionPriority;
  effort?: number | null;
  links?: { targetType: ActionLinkTarget; targetId: string }[];
}

/** Crée une action et, le cas échéant, pré-lie les exigences/contrôles (RM §5.5). */
export async function createAction(tx: TenantTx, input: CreateActionInput): Promise<string> {
  const [row] = await tx
    .insert(schema.actions)
    .values({
      tenantId: input.tenantId,
      title: input.title,
      description: input.description ?? null,
      originType: input.originType,
      originId: input.originId ?? null,
      ownerUserId: input.ownerUserId ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? 'p2',
      effort: input.effort ?? null,
    })
    .returning({ id: schema.actions.id });
  const actionId = row!.id;

  for (const link of input.links ?? []) {
    await tx
      .insert(schema.actionLinks)
      .values({
        tenantId: input.tenantId,
        actionId,
        targetType: link.targetType,
        targetId: link.targetId,
      })
      .onConflictDoNothing();
  }
  return actionId;
}

export interface ActionSummary {
  id: string;
  title: string;
  description: string | null;
  originType: ActionOrigin;
  originId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  priority: ActionPriority;
  effort: number | null;
  status: ActionStatus;
  effectiveStatus: ActionEffectiveStatus;
  subtaskDone: number;
  subtaskTotal: number;
  commentCount: number;
  linkCount: number;
}

interface RawAction {
  id: string;
  title: string;
  description: string | null;
  origin_type: ActionOrigin;
  origin_id: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  priority: ActionPriority;
  effort: number | null;
  status: ActionStatus;
  subtask_done: number | string;
  subtask_total: number | string;
  comment_count: number | string;
  link_count: number | string;
}

export interface ActionFilter {
  status?: ActionStatus;
  ownerUserId?: string;
  originType?: ActionOrigin;
}

/** Liste les actions du tenant avec compteurs et statut effectif (retard dérivé). */
export async function listActions(tx: TenantTx, filter?: ActionFilter): Promise<ActionSummary[]> {
  const conds = [];
  if (filter?.status) conds.push(sql`a.status = ${filter.status}`);
  if (filter?.ownerUserId) conds.push(sql`a.owner_user_id = ${filter.ownerUserId}`);
  if (filter?.originType) conds.push(sql`a.origin_type = ${filter.originType}`);
  const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = await tx.execute(sql`
    SELECT
      a.id, a.title, a.description, a.origin_type, a.origin_id, a.owner_user_id,
      o.name AS owner_name, a.due_date::text AS due_date, a.priority, a.effort, a.status,
      (SELECT count(*) FROM action_subtasks st WHERE st.action_id = a.id AND st.done) AS subtask_done,
      (SELECT count(*) FROM action_subtasks st WHERE st.action_id = a.id) AS subtask_total,
      (SELECT count(*) FROM action_comments cc WHERE cc.action_id = a.id) AS comment_count,
      (SELECT count(*) FROM action_links al WHERE al.action_id = a.id) AS link_count
    FROM actions a
    LEFT JOIN users o ON o.id = a.owner_user_id
    ${where}
    ORDER BY a.priority, a.due_date NULLS LAST, a.created_at DESC
  `);

  const now = new Date();
  return (rows as unknown as RawAction[]).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    originType: r.origin_type,
    originId: r.origin_id,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name,
    dueDate: r.due_date,
    priority: r.priority,
    effort: r.effort,
    status: r.status,
    effectiveStatus: effectiveActionStatus(
      { status: r.status, dueDate: r.due_date ? new Date(r.due_date) : null },
      now,
    ),
    subtaskDone: Number(r.subtask_done),
    subtaskTotal: Number(r.subtask_total),
    commentCount: Number(r.comment_count),
    linkCount: Number(r.link_count),
  }));
}

export interface UpdateActionInput {
  actionId: string;
  title?: string;
  description?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  priority?: ActionPriority;
  effort?: number | null;
}

/** Met à jour les attributs d'une action. Renvoie le nombre de lignes. */
export async function updateActionDetails(tx: TenantTx, input: UpdateActionInput): Promise<number> {
  const set: Partial<typeof schema.actions.$inferInsert> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.description !== undefined) set.description = input.description;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;
  if (input.priority !== undefined) set.priority = input.priority;
  if (input.effort !== undefined) set.effort = input.effort;
  if (Object.keys(set).length === 0) return 0;
  const updated = await tx
    .update(schema.actions)
    .set(set)
    .where(eq(schema.actions.id, input.actionId))
    .returning({ id: schema.actions.id });
  return updated.length;
}

/** Change le statut STOCKÉ d'une action (jamais « en_retard », qui est dérivé). */
export async function setActionStatus(
  tx: TenantTx,
  actionId: string,
  status: ActionStatus,
): Promise<number> {
  const updated = await tx
    .update(schema.actions)
    .set({ status })
    .where(eq(schema.actions.id, actionId))
    .returning({ id: schema.actions.id });
  return updated.length;
}

/** Change le statut de plusieurs actions à la fois (action groupée). Renvoie le nombre modifié. */
export async function bulkSetStatus(
  tx: TenantTx,
  actionIds: string[],
  status: ActionStatus,
): Promise<number> {
  if (actionIds.length === 0) return 0;
  const updated = await tx
    .update(schema.actions)
    .set({ status })
    .where(inArray(schema.actions.id, actionIds))
    .returning({ id: schema.actions.id });
  return updated.length;
}

// ── Sous-tâches ─────────────────────────────────────────────────────────
export async function addSubtask(
  tx: TenantTx,
  input: { tenantId: string; actionId: string; title: string },
): Promise<string> {
  const [row] = await tx
    .insert(schema.actionSubtasks)
    .values({ tenantId: input.tenantId, actionId: input.actionId, title: input.title })
    .returning({ id: schema.actionSubtasks.id });
  return row!.id;
}

export async function setSubtaskDone(tx: TenantTx, subtaskId: string, done: boolean): Promise<number> {
  const updated = await tx
    .update(schema.actionSubtasks)
    .set({ done })
    .where(eq(schema.actionSubtasks.id, subtaskId))
    .returning({ id: schema.actionSubtasks.id });
  return updated.length;
}

// ── Commentaires (append-only) ──────────────────────────────────────────
export async function addComment(
  tx: TenantTx,
  input: { tenantId: string; actionId: string; authorUserId: string; body: string },
): Promise<string> {
  const [row] = await tx
    .insert(schema.actionComments)
    .values({
      tenantId: input.tenantId,
      actionId: input.actionId,
      authorUserId: input.authorUserId,
      body: input.body,
    })
    .returning({ id: schema.actionComments.id });
  return row!.id;
}

// ── Liaisons ────────────────────────────────────────────────────────────
export async function linkAction(
  tx: TenantTx,
  input: { tenantId: string; actionId: string; targetType: ActionLinkTarget; targetId: string },
): Promise<void> {
  await tx
    .insert(schema.actionLinks)
    .values({
      tenantId: input.tenantId,
      actionId: input.actionId,
      targetType: input.targetType,
      targetId: input.targetId,
    })
    .onConflictDoNothing();
}

export async function unlinkAction(
  tx: TenantTx,
  input: { actionId: string; targetType: ActionLinkTarget; targetId: string },
): Promise<number> {
  const deleted = await tx
    .delete(schema.actionLinks)
    .where(
      and(
        eq(schema.actionLinks.actionId, input.actionId),
        eq(schema.actionLinks.targetType, input.targetType),
        eq(schema.actionLinks.targetId, input.targetId),
      ),
    )
    .returning({ actionId: schema.actionLinks.actionId });
  return deleted.length;
}

// ── Détail d'une action ─────────────────────────────────────────────────
export interface ActionSubtaskRow {
  id: string;
  title: string;
  done: boolean;
}
export interface ActionCommentRow {
  id: string;
  authorName: string | null;
  body: string;
  createdAt: Date;
}
export interface ActionLinkRow {
  targetType: ActionLinkTarget;
  targetId: string;
  label: string;
}
export interface ActionDetail {
  subtasks: ActionSubtaskRow[];
  comments: ActionCommentRow[];
  links: ActionLinkRow[];
}

/** Sous-tâches, commentaires et liaisons (avec libellés) d'une action. */
export async function getActionDetail(tx: TenantTx, actionId: string): Promise<ActionDetail> {
  const subs = await tx.execute(sql`
    SELECT id, title, done FROM action_subtasks WHERE action_id = ${actionId} ORDER BY sort_order, created_at
  `);
  const comments = await tx.execute(sql`
    SELECT c.id, u.name AS author_name, c.body, c.created_at::text AS created_at
    FROM action_comments c LEFT JOIN users u ON u.id = c.author_user_id
    WHERE c.action_id = ${actionId} ORDER BY c.created_at
  `);
  // Libellé des cibles : ref d'exigence ou titre de contrôle.
  const links = await tx.execute(sql`
    SELECT al.target_type, al.target_id,
      COALESCE(r.ref_id, ct.title, al.target_id::text) AS label
    FROM action_links al
    LEFT JOIN requirements r ON al.target_type = 'requirement' AND r.id = al.target_id
    LEFT JOIN controls ct ON al.target_type = 'control' AND ct.id = al.target_id
    WHERE al.action_id = ${actionId}
  `);
  return {
    subtasks: (subs as unknown as { id: string; title: string; done: boolean }[]).map((s) => ({
      id: s.id,
      title: s.title,
      done: s.done,
    })),
    comments: (
      comments as unknown as { id: string; author_name: string | null; body: string; created_at: string }[]
    ).map((c) => ({
      id: c.id,
      authorName: c.author_name,
      body: c.body,
      createdAt: new Date(c.created_at),
    })),
    links: (
      links as unknown as { target_type: ActionLinkTarget; target_id: string; label: string }[]
    ).map((l) => ({ targetType: l.target_type, targetId: l.target_id, label: l.label })),
  };
}
