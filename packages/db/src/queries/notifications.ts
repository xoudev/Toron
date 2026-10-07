import {
  assignmentTitle,
  decisionRecipients,
  exceptionDecisionTitle,
  notificationHref,
  shouldNotifyAssignment,
  type NotificationSubject,
} from '@toron/core';
import { sql } from 'drizzle-orm';

import type { TenantTx } from '../tenant.ts';

// ── Centre de notifications (module 5.12) ──────────────────────────────
// Chaque lecture est bornée au destinataire (userId issu de la session) ;
// la politique RLS borne déjà à l'organisation courante.

/** Tables dont on suit le responsable, et la colonne qui le porte. */
const OWNER_COLUMN: Record<NotificationSubject, { table: string; column: string }> = {
  action: { table: 'actions', column: 'owner_user_id' },
  risque: { table: 'risks', column: 'owner_user_id' },
  obligation: { table: 'obligations', column: 'owner_user_id' },
  fournisseur: { table: 'suppliers', column: 'owner_user_id' },
  traitement: { table: 'processing_activities', column: 'owner_user_id' },
  derogation: { table: 'policy_exceptions', column: 'owner_user_id' },
  controle: { table: 'controls', column: 'owner_user_id' },
};

/** Responsable actuel d'un objet (avant modification), ou null. */
export async function currentOwner(tx: TenantTx, subject: NotificationSubject, objectId: string): Promise<string | null> {
  const { table, column } = OWNER_COLUMN[subject];
  const [row] = (await tx.execute(sql`
    SELECT ${sql.identifier(column)} AS owner FROM ${sql.identifier(table)} WHERE id = ${objectId}
  `)) as unknown as { owner: string | null }[];
  return row?.owner ?? null;
}

export interface AssignmentNotice {
  tenantId: string;
  slug: string;
  actorUserId: string;
  subject: NotificationSubject;
  objectId: string;
  objectTitle: string;
  previousOwnerId: string | null;
  nextOwnerId: string | null;
}

/**
 * Prévient le nouveau responsable d'un objet. Sans effet si la règle ne le
 * demande pas, ou si le destinataire n'est pas membre de l'organisation.
 * Renvoie true si une notification a été créée.
 */
export async function notifyAssignment(tx: TenantTx, n: AssignmentNotice): Promise<boolean> {
  if (!shouldNotifyAssignment(n)) return false;
  const rows = (await tx.execute(sql`
    INSERT INTO notifications (tenant_id, user_id, kind, subject, title, href, actor_user_id)
    SELECT m.tenant_id, m.user_id, 'assignation', ${n.subject},
           ${assignmentTitle(n.subject, n.objectTitle)}, ${notificationHref(n.slug, n.subject, n.objectId)}, ${n.actorUserId}
    FROM memberships m WHERE m.tenant_id = ${n.tenantId} AND m.user_id = ${n.nextOwnerId}
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/**
 * Prévient le demandeur et le responsable d'une dérogation de la décision
 * prise (jamais le décideur lui-même). Seuls les membres actuels de
 * l'organisation sont notifiés. Renvoie le nombre de notifications créées.
 */
export async function notifyExceptionDecision(
  tx: TenantTx,
  n: { tenantId: string; slug: string; actorUserId: string; exceptionId: string; title: string; requestedBy: string; ownerUserId: string; approved: boolean },
): Promise<number> {
  const recipients = decisionRecipients(n);
  if (recipients.length === 0) return 0;
  const rows = (await tx.execute(sql`
    INSERT INTO notifications (tenant_id, user_id, kind, subject, title, href, actor_user_id)
    SELECT m.tenant_id, m.user_id, 'decision', 'derogation',
           ${exceptionDecisionTitle(n.approved, n.title)}, ${notificationHref(n.slug, 'derogation', n.exceptionId)}, ${n.actorUserId}
    FROM memberships m
    WHERE m.tenant_id = ${n.tenantId} AND m.user_id IN (${sql.join(recipients.map((r) => sql`${r}`), sql`, `)})
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length;
}

export interface NotificationRow {
  id: string;
  subject: NotificationSubject;
  title: string;
  href: string;
  actorName: string | null;
  createdAt: Date;
  readAt: Date | null;
}

/** Notifications du membre, les plus récentes d'abord. */
export async function listMyNotifications(tx: TenantTx, userId: string, limit = 30): Promise<NotificationRow[]> {
  const rows = (await tx.execute(sql`
    SELECT n.id, n.subject, n.title, n.href, u.name AS actor_name, n.created_at, n.read_at
    FROM notifications n LEFT JOIN users u ON u.id = n.actor_user_id
    WHERE n.user_id = ${userId}
    ORDER BY n.created_at DESC
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `)) as unknown as { id: string; subject: NotificationSubject; title: string; href: string; actor_name: string | null; created_at: string | Date; read_at: string | Date | null }[];
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    title: r.title,
    href: r.href,
    actorName: r.actor_name,
    createdAt: new Date(r.created_at),
    readAt: r.read_at ? new Date(r.read_at) : null,
  }));
}

export async function countUnreadNotifications(tx: TenantTx, userId: string): Promise<number> {
  const [row] = (await tx.execute(sql`
    SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL
  `)) as unknown as { n: number }[];
  return row?.n ?? 0;
}

/** Marque comme lues les notifications du membre (toutes, ou celles listées). */
export async function markNotificationsRead(tx: TenantTx, userId: string, ids?: readonly string[]): Promise<number> {
  const filter = ids && ids.length > 0 ? sql`AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``;
  const rows = (await tx.execute(sql`
    UPDATE notifications SET read_at = clock_timestamp()
    WHERE user_id = ${userId} AND read_at IS NULL ${filter}
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length;
}
