import { canCloseIncident, nis2Deadlines, type IncidentSeverity, type NotifKind } from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des incidents & chronologie NIS 2 (module 6.1) ──────
// RLS active. Les échéances réglementaires sont posées à la QUALIFICATION
// via @toron/core (RM §6.1). La timeline est append-only.

export interface CreateIncidentInput {
  tenantId: string;
  title: string;
  description?: string | null;
  severity: IncidentSeverity;
  ownerUserId?: string | null;
  detectedBy: string;
}

export async function createIncident(tx: TenantTx, input: CreateIncidentInput): Promise<string> {
  const [row] = await tx
    .insert(schema.incidents)
    .values({
      tenantId: input.tenantId,
      title: input.title,
      description: input.description ?? null,
      severity: input.severity,
      ownerUserId: input.ownerUserId ?? null,
    })
    .returning({ id: schema.incidents.id });
  const id = row!.id;
  await tx.insert(schema.incidentEvents).values({
    tenantId: input.tenantId,
    incidentId: id,
    kind: 'detection',
    description: 'Incident déclaré et ouvert.',
    authorUserId: input.detectedBy,
  });
  return id;
}

export interface QualifyInput {
  tenantId: string;
  incidentId: string;
  nis2Important: boolean;
  criteria: Record<string, boolean>;
  gdprBreach: boolean;
  qualifiedBy: string;
}

/**
 * Qualifie un incident : pose l'horodatage de qualification, le statut, les
 * critères, puis l'ÉCHÉANCIER réglementaire (RM §6.1). Idempotent sur les
 * notifications (ON CONFLICT). Renvoie le nombre d'échéances posées.
 */
export async function qualifyIncident(tx: TenantTx, input: QualifyInput): Promise<number> {
  const qualifiedAt = new Date();
  await tx
    .update(schema.incidents)
    .set({
      status: 'qualifie',
      qualifiedAt,
      nis2Important: input.nis2Important,
      nis2Criteria: input.criteria,
      gdprBreach: input.gdprBreach,
    })
    .where(eq(schema.incidents.id, input.incidentId));

  const plans = nis2Deadlines(qualifiedAt, input.gdprBreach).filter((p) =>
    p.kind === 'cnil_72h' ? input.gdprBreach : input.nis2Important,
  );
  for (const p of plans) {
    await tx
      .insert(schema.incidentNotifications)
      .values({ tenantId: input.tenantId, incidentId: input.incidentId, kind: p.kind, dueAt: p.dueAt })
      .onConflictDoNothing();
  }
  await tx.insert(schema.incidentEvents).values({
    tenantId: input.tenantId,
    incidentId: input.incidentId,
    kind: 'qualification',
    description: input.nis2Important
      ? 'Qualifié « incident important » NIS 2 — échéancier réglementaire armé.'
      : 'Qualifié — non important au sens NIS 2.',
    authorUserId: input.qualifiedBy,
  });
  return plans.length;
}

export async function addEvent(
  tx: TenantTx,
  input: { tenantId: string; incidentId: string; kind: string; description: string; authorUserId: string },
): Promise<void> {
  await tx.insert(schema.incidentEvents).values({
    tenantId: input.tenantId,
    incidentId: input.incidentId,
    kind: input.kind,
    description: input.description,
    authorUserId: input.authorUserId,
  });
}

export async function markNotificationSent(
  tx: TenantTx,
  input: { incidentId: string; kind: NotifKind; exportRef?: string | null },
): Promise<number> {
  const updated = await tx
    .update(schema.incidentNotifications)
    .set({ sentAt: new Date(), exportRef: input.exportRef ?? null })
    .where(
      and(
        eq(schema.incidentNotifications.incidentId, input.incidentId),
        eq(schema.incidentNotifications.kind, input.kind),
      ),
    )
    .returning({ id: schema.incidentNotifications.id });
  return updated.length;
}

export type CloseResult = { outcome: 'closed' } | { outcome: 'rex_requis' } | { outcome: 'introuvable' };

/** Clôture un incident. Refuse sans REX si l'incident est important (RM §6.1). */
export async function closeIncident(
  tx: TenantTx,
  input: { tenantId: string; incidentId: string; rex: string | null; closedBy: string },
): Promise<CloseResult> {
  const [inc] = await tx
    .select({ nis2Important: schema.incidents.nis2Important })
    .from(schema.incidents)
    .where(eq(schema.incidents.id, input.incidentId));
  if (!inc) return { outcome: 'introuvable' };
  if (!canCloseIncident({ nis2Important: inc.nis2Important, rex: input.rex })) {
    return { outcome: 'rex_requis' };
  }
  await tx
    .update(schema.incidents)
    .set({ status: 'clos', closedAt: new Date(), rex: input.rex })
    .where(eq(schema.incidents.id, input.incidentId));
  await tx.insert(schema.incidentEvents).values({
    tenantId: input.tenantId,
    incidentId: input.incidentId,
    kind: 'cloture',
    description: 'Incident clos — retour d’expérience consigné.',
    authorUserId: input.closedBy,
  });
  return { outcome: 'closed' };
}

export interface IncidentSummary {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: string;
  openedAt: Date;
  qualifiedAt: Date | null;
  nis2Important: boolean;
  gdprBreach: boolean;
  ownerName: string | null;
}

interface RawIncident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: string;
  opened_at: string;
  qualified_at: string | null;
  nis2_important: boolean;
  gdpr_breach: boolean;
  owner_name: string | null;
}

export async function listIncidents(tx: TenantTx): Promise<IncidentSummary[]> {
  const rows = await tx.execute(sql`
    SELECT i.id, i.title, i.severity, i.status,
           i.opened_at::text AS opened_at, i.qualified_at::text AS qualified_at,
           i.nis2_important, i.gdpr_breach, u.name AS owner_name
    FROM incidents i LEFT JOIN users u ON u.id = i.owner_user_id
    ORDER BY (i.status = 'clos'), i.opened_at DESC
  `);
  return (rows as unknown as RawIncident[]).map((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    status: r.status,
    openedAt: new Date(r.opened_at),
    qualifiedAt: r.qualified_at ? new Date(r.qualified_at) : null,
    nis2Important: r.nis2_important,
    gdprBreach: r.gdpr_breach,
    ownerName: r.owner_name,
  }));
}

export interface IncidentDetail extends IncidentSummary {
  description: string | null;
  nis2Criteria: Record<string, boolean> | null;
  rex: string | null;
  closedAt: Date | null;
  events: { at: Date; kind: string; description: string; authorName: string | null }[];
  notifications: { kind: NotifKind; dueAt: Date; sentAt: Date | null }[];
}

export async function getIncident(tx: TenantTx, incidentId: string): Promise<IncidentDetail | null> {
  const list = await listIncidents(tx);
  const base = list.find((i) => i.id === incidentId);
  if (!base) return null;
  const [extraRow] = (await tx.execute(sql`
    SELECT description, nis2_criteria, rex, closed_at::text AS closed_at FROM incidents WHERE id = ${incidentId}
  `)) as unknown as { description: string | null; nis2_criteria: Record<string, boolean> | null; rex: string | null; closed_at: string | null }[];
  const events = (await tx.execute(sql`
    SELECT e.at::text AS at, e.kind, e.description, u.name AS author_name
    FROM incident_events e LEFT JOIN users u ON u.id = e.author_user_id
    WHERE e.incident_id = ${incidentId} ORDER BY e.at
  `)) as unknown as { at: string; kind: string; description: string; author_name: string | null }[];
  const notifs = (await tx.execute(sql`
    SELECT kind, due_at::text AS due_at, sent_at::text AS sent_at
    FROM incident_notifications WHERE incident_id = ${incidentId} ORDER BY due_at
  `)) as unknown as { kind: NotifKind; due_at: string; sent_at: string | null }[];

  const parse = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));
  return {
    ...base,
    description: extraRow?.description ?? null,
    nis2Criteria: extraRow?.nis2_criteria ? parse<Record<string, boolean>>(extraRow.nis2_criteria) : null,
    rex: extraRow?.rex ?? null,
    closedAt: extraRow?.closed_at ? new Date(extraRow.closed_at) : null,
    events: events.map((e) => ({ at: new Date(e.at), kind: e.kind, description: e.description, authorName: e.author_name })),
    notifications: notifs.map((n) => ({ kind: n.kind, dueAt: new Date(n.due_at), sentAt: n.sent_at ? new Date(n.sent_at) : null })),
  };
}
