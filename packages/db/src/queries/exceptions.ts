import { exceptionState, type ExceptionRenewal, type ExceptionState, type ExceptionStatus } from '@toron/core';
import { and, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Dérogations aux règles (migration 0032) ────────────────────────────
// Opère sur une TenantTx (RLS active). L'état (en vigueur, échue…) est
// calculé par @toron/core à partir des dates du jour : jamais stocké.

export interface ExceptionRow {
  id: string;
  title: string;
  rule: string;
  justification: string;
  compensatingMeasures: string;
  controlId: string | null;
  controlTitle: string | null;
  assetId: string | null;
  assetName: string | null;
  requestedBy: string;
  requesterName: string | null;
  ownerUserId: string;
  ownerName: string | null;
  startsOn: string;
  expiresOn: string;
  status: ExceptionStatus;
  deciderName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  closerName: string | null;
  closedAt: Date | null;
  closureNote: string | null;
  renewedFromId: string | null;
  renewal: ExceptionRenewal;
  /** Renouvellement demandé ou accordé qui prend la suite, le cas échéant. */
  renewalId: string | null;
  createdAt: Date;
  state: ExceptionState;
}

interface RawException {
  id: string;
  title: string;
  rule: string;
  justification: string;
  compensating_measures: string;
  control_id: string | null;
  control_title: string | null;
  asset_id: string | null;
  asset_name: string | null;
  requested_by: string;
  requester_name: string | null;
  owner_user_id: string;
  owner_name: string | null;
  starts_on: string;
  expires_on: string;
  status: ExceptionStatus;
  decider_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  closer_name: string | null;
  closed_at: string | null;
  closure_note: string | null;
  renewed_from_id: string | null;
  renewal_id: string | null;
  renewal_status: ExceptionStatus | null;
  created_at: string;
}

function renewalOf(status: ExceptionStatus | null): ExceptionRenewal {
  if (status === 'approuvee') return 'accorde';
  if (status === 'demandee') return 'demande';
  return 'aucun';
}

/** Dérogations de l'organisation avec leurs parties, liens et état à la date donnée (AAAA-MM-JJ). */
export async function listExceptions(tx: TenantTx, today: string): Promise<ExceptionRow[]> {
  const rows = (await tx.execute(sql`
    SELECT e.id, e.title, e.rule, e.justification, e.compensating_measures,
           e.control_id, c.title AS control_title, e.asset_id, a.name AS asset_name,
           e.requested_by, req.name AS requester_name, e.owner_user_id, own.name AS owner_name,
           e.starts_on::text AS starts_on, e.expires_on::text AS expires_on, e.status,
           dec.name AS decider_name, e.decided_at::text AS decided_at, e.decision_note,
           clo.name AS closer_name, e.closed_at::text AS closed_at, e.closure_note,
           e.renewed_from_id, ren.id AS renewal_id, ren.status AS renewal_status,
           e.created_at::text AS created_at
    FROM policy_exceptions e
    LEFT JOIN controls c ON c.id = e.control_id
    LEFT JOIN assets a ON a.id = e.asset_id
    LEFT JOIN users req ON req.id = e.requested_by
    LEFT JOIN users own ON own.id = e.owner_user_id
    LEFT JOIN users dec ON dec.id = e.decided_by
    LEFT JOIN users clo ON clo.id = e.closed_by
    LEFT JOIN LATERAL (
      SELECT n.id, n.status FROM policy_exceptions n
      WHERE n.renewed_from_id = e.id AND n.status IN ('demandee', 'approuvee')
      LIMIT 1
    ) ren ON true
    ORDER BY e.expires_on, e.created_at
  `)) as unknown as RawException[];

  return rows.map((r) => {
    const renewal = renewalOf(r.renewal_status);
    return {
      id: r.id,
      title: r.title,
      rule: r.rule,
      justification: r.justification,
      compensatingMeasures: r.compensating_measures,
      controlId: r.control_id,
      controlTitle: r.control_title,
      assetId: r.asset_id,
      assetName: r.asset_name,
      requestedBy: r.requested_by,
      requesterName: r.requester_name,
      ownerUserId: r.owner_user_id,
      ownerName: r.owner_name,
      startsOn: r.starts_on,
      expiresOn: r.expires_on,
      status: r.status,
      deciderName: r.decider_name,
      decidedAt: r.decided_at ? new Date(r.decided_at) : null,
      decisionNote: r.decision_note,
      closerName: r.closer_name,
      closedAt: r.closed_at ? new Date(r.closed_at) : null,
      closureNote: r.closure_note,
      renewedFromId: r.renewed_from_id,
      renewal,
      renewalId: r.renewal_id,
      createdAt: new Date(r.created_at),
      state: exceptionState({ status: r.status, startsOn: r.starts_on, expiresOn: r.expires_on, renewal }, today),
    };
  });
}

export interface ExceptionRef {
  id: string;
  title: string;
  rule: string;
  justification: string;
  compensatingMeasures: string;
  controlId: string | null;
  assetId: string | null;
  status: ExceptionStatus;
  requestedBy: string;
  ownerUserId: string;
  startsOn: string;
  expiresOn: string;
  renewal: ExceptionRenewal;
}

/** Ce qu'il faut savoir d'une dérogation pour décider d'une mutation, ou null si elle n'existe pas. */
export async function getExceptionRef(tx: TenantTx, exceptionId: string): Promise<ExceptionRef | null> {
  const [row] = (await tx.execute(sql`
    SELECT e.id, e.title, e.rule, e.justification, e.compensating_measures, e.control_id, e.asset_id,
           e.status, e.requested_by, e.owner_user_id,
           e.starts_on::text AS starts_on, e.expires_on::text AS expires_on,
           (SELECT n.status FROM policy_exceptions n
             WHERE n.renewed_from_id = e.id AND n.status IN ('demandee', 'approuvee') LIMIT 1) AS renewal_status
    FROM policy_exceptions e WHERE e.id = ${exceptionId}
  `)) as unknown as {
    id: string; title: string; rule: string; justification: string; compensating_measures: string;
    control_id: string | null; asset_id: string | null; status: ExceptionStatus; requested_by: string;
    owner_user_id: string; starts_on: string; expires_on: string; renewal_status: ExceptionStatus | null;
  }[];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    rule: row.rule,
    justification: row.justification,
    compensatingMeasures: row.compensating_measures,
    controlId: row.control_id,
    assetId: row.asset_id,
    status: row.status,
    requestedBy: row.requested_by,
    ownerUserId: row.owner_user_id,
    startsOn: row.starts_on,
    expiresOn: row.expires_on,
    renewal: renewalOf(row.renewal_status),
  };
}

export interface ExceptionInput {
  title: string;
  rule: string;
  justification: string;
  compensatingMeasures: string;
  controlId: string | null;
  assetId: string | null;
  ownerUserId: string;
  startsOn: string;
  expiresOn: string;
}

/** Enregistre une demande de dérogation (ou de renouvellement). Renvoie son id. */
export async function createException(
  tx: TenantTx,
  input: ExceptionInput & { tenantId: string; requestedBy: string; renewedFromId?: string | null },
): Promise<string> {
  const [row] = await tx
    .insert(schema.policyExceptions)
    .values({
      tenantId: input.tenantId,
      title: input.title,
      rule: input.rule,
      justification: input.justification,
      compensatingMeasures: input.compensatingMeasures,
      controlId: input.controlId,
      assetId: input.assetId,
      requestedBy: input.requestedBy,
      ownerUserId: input.ownerUserId,
      startsOn: input.startsOn,
      expiresOn: input.expiresOn,
      renewedFromId: input.renewedFromId ?? null,
    })
    .returning({ id: schema.policyExceptions.id });
  return row!.id;
}

/** Modifie une demande encore en attente. Renvoie le nombre de lignes (0 si tranchée entre-temps). */
export async function updateExceptionRequest(tx: TenantTx, exceptionId: string, input: ExceptionInput): Promise<number> {
  const updated = await tx
    .update(schema.policyExceptions)
    .set(input)
    .where(and(eq(schema.policyExceptions.id, exceptionId), eq(schema.policyExceptions.status, 'demandee')))
    .returning({ id: schema.policyExceptions.id });
  return updated.length;
}

/** Tranche une demande en attente. Renvoie le nombre de lignes (0 si déjà tranchée). */
export async function decideException(
  tx: TenantTx,
  input: { exceptionId: string; decidedBy: string; approve: boolean; note: string | null },
): Promise<number> {
  const updated = await tx
    .update(schema.policyExceptions)
    .set({
      status: input.approve ? 'approuvee' : 'refusee',
      decidedBy: input.decidedBy,
      decidedAt: sql`now()`,
      decisionNote: input.note,
    })
    .where(and(eq(schema.policyExceptions.id, input.exceptionId), eq(schema.policyExceptions.status, 'demandee')))
    .returning({ id: schema.policyExceptions.id });
  return updated.length;
}

/** Clôture une demande ou une dérogation accordée. Renvoie le nombre de lignes (0 si déjà close). */
export async function closeException(
  tx: TenantTx,
  input: { exceptionId: string; closedBy: string; note: string | null },
): Promise<number> {
  const updated = await tx
    .update(schema.policyExceptions)
    .set({ status: 'cloturee', closedBy: input.closedBy, closedAt: sql`now()`, closureNote: input.note })
    .where(and(
      eq(schema.policyExceptions.id, input.exceptionId),
      inArray(schema.policyExceptions.status, ['demandee', 'approuvee']),
    ))
    .returning({ id: schema.policyExceptions.id });
  return updated.length;
}
