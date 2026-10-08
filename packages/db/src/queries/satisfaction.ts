import {
  SATISFACTION_WINDOW_MONTHS,
  addMonthsIso,
  complaintsTrend,
  surveyScore,
  surveyTrend,
  surveyVerdict,
  type SurveyMethod,
  type SurveyTrend,
  type SurveyVerdict,
} from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Satisfaction client (migration 0036) ───────────────────────────────
// Opère sur une TenantTx (RLS active). Les enquêtes sont des résultats
// agrégés ; les réclamations sont les non-conformités de source
// « réclamation client ».

export interface CustomerSurveyRow {
  id: string;
  title: string;
  method: SurveyMethod;
  segment: string | null;
  closedOn: string;
  invitedCount: number | null;
  respondents: number;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  satisfied: number | null;
  target: number | null;
  findings: string | null;
  evidenceId: string | null;
  evidenceTitle: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  /** NPS en points, ou CSAT en pourcentage. */
  score: number;
  verdict: SurveyVerdict;
  /** Score de la mesure précédente de même méthode et même segment, et tendance. */
  previousScore: number | null;
  trend: SurveyTrend | null;
}

interface RawSurvey {
  id: string;
  title: string;
  method: SurveyMethod;
  segment: string | null;
  closed_on: string;
  invited_count: number | null;
  respondents: number;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  satisfied: number | null;
  target: number | null;
  findings: string | null;
  evidence_id: string | null;
  evidence_title: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
}

/** Enquêtes, les plus récentes d'abord, avec score, objectif et tendance. */
export async function listCustomerSurveys(tx: TenantTx): Promise<CustomerSurveyRow[]> {
  const rows = (await tx.execute(sql`
    SELECT s.id, s.title, s.method, s.segment, s.closed_on::text AS closed_on, s.invited_count, s.respondents,
           s.promoters, s.passives, s.detractors, s.satisfied, s.target, s.findings, s.evidence_id, ev.title AS evidence_title,
           s.owner_user_id, u.name AS owner_name
    FROM customer_surveys s
    LEFT JOIN evidences ev ON ev.id = s.evidence_id
    LEFT JOIN users u ON u.id = s.owner_user_id
    ORDER BY s.closed_on DESC, s.created_at DESC
  `)) as unknown as RawSurvey[];
  const scored = rows.map((r) => ({
    r,
    score: surveyScore({
      method: r.method, respondents: r.respondents, promoters: r.promoters, passives: r.passives, detractors: r.detractors, satisfied: r.satisfied,
    }),
  }));
  return scored.map(({ r, score }, i) => {
    // Mesure précédente : la suivante dans l'ordre décroissant, même méthode et même segment.
    const previous = scored.slice(i + 1).find((o) => o.r.method === r.method && (o.r.segment ?? '') === (r.segment ?? ''));
    const previousScore = previous ? previous.score : null;
    return {
      id: r.id,
      title: r.title,
      method: r.method,
      segment: r.segment,
      closedOn: r.closed_on,
      invitedCount: r.invited_count,
      respondents: r.respondents,
      promoters: r.promoters,
      passives: r.passives,
      detractors: r.detractors,
      satisfied: r.satisfied,
      target: r.target,
      findings: r.findings,
      evidenceId: r.evidence_id,
      evidenceTitle: r.evidence_title,
      ownerUserId: r.owner_user_id,
      ownerName: r.owner_name,
      score,
      verdict: surveyVerdict(score, r.target),
      previousScore,
      trend: surveyTrend(score, previousScore),
    };
  });
}

export interface CustomerSurveyInput {
  title: string;
  method: SurveyMethod;
  segment: string | null;
  closedOn: string;
  invitedCount: number | null;
  respondents: number;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  satisfied: number | null;
  target: number | null;
  findings: string | null;
  evidenceId: string | null;
  ownerUserId: string | null;
}

export async function createCustomerSurvey(tx: TenantTx, input: CustomerSurveyInput & { tenantId: string; createdBy: string }): Promise<string> {
  const [row] = await tx.insert(schema.customerSurveys).values(input).returning({ id: schema.customerSurveys.id });
  return row!.id;
}

export async function updateCustomerSurvey(tx: TenantTx, surveyId: string, input: CustomerSurveyInput): Promise<number> {
  const updated = await tx.update(schema.customerSurveys).set(input)
    .where(eq(schema.customerSurveys.id, surveyId)).returning({ id: schema.customerSurveys.id });
  return updated.length;
}

export async function deleteCustomerSurvey(tx: TenantTx, surveyId: string): Promise<{ title: string } | null> {
  const [row] = await tx.delete(schema.customerSurveys).where(eq(schema.customerSurveys.id, surveyId))
    .returning({ title: schema.customerSurveys.title });
  return row ?? null;
}

export interface CustomerSurveyRef {
  title: string;
  method: SurveyMethod;
  closedOn: string;
  respondents: number;
  ownerUserId: string | null;
  evidenceId: string | null;
}

/** Ce qu'il faut d'une enquête pour la modifier, la supprimer ou la tracer ; null si elle n'existe pas. */
export async function getCustomerSurveyRef(tx: TenantTx, surveyId: string): Promise<CustomerSurveyRef | null> {
  const [row] = await tx
    .select({
      title: schema.customerSurveys.title,
      method: schema.customerSurveys.method,
      closedOn: schema.customerSurveys.closedOn,
      respondents: schema.customerSurveys.respondents,
      ownerUserId: schema.customerSurveys.ownerUserId,
      evidenceId: schema.customerSurveys.evidenceId,
    })
    .from(schema.customerSurveys)
    .where(eq(schema.customerSurveys.id, surveyId));
  return row ?? null;
}

/** Rattache le rapport d'une enquête déposé au coffre de preuves. Renvoie le nombre de lignes. */
export async function setCustomerSurveyEvidence(tx: TenantTx, surveyId: string, evidenceId: string): Promise<number> {
  const updated = await tx.update(schema.customerSurveys).set({ evidenceId })
    .where(eq(schema.customerSurveys.id, surveyId)).returning({ id: schema.customerSurveys.id });
  return updated.length;
}

export interface ComplaintRow {
  id: string;
  title: string;
  status: string;
  gravity: string;
  openedOn: string;
}

/** Réclamations clients (non-conformités de cette source) ouvertes depuis une date, les plus récentes d'abord. */
export async function listComplaints(tx: TenantTx, since: string): Promise<ComplaintRow[]> {
  const rows = (await tx.execute(sql`
    SELECT id, title, status::text AS status, gravity::text AS gravity, (opened_at AT TIME ZONE 'Europe/Paris')::date::text AS opened_on
    FROM nonconformities
    WHERE source = 'reclamation_client' AND (opened_at AT TIME ZONE 'Europe/Paris')::date > ${since}
    ORDER BY opened_at DESC
  `)) as unknown as { id: string; title: string; status: string; gravity: string; opened_on: string }[];
  return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, gravity: r.gravity, openedOn: r.opened_on }));
}

export interface SatisfactionOverview {
  /** Dernière mesure NPS et dernière mesure CSAT, tous segments confondus. */
  lastNps: CustomerSurveyRow | null;
  lastCsat: CustomerSurveyRow | null;
  /** Enquêtes closes sur douze mois, dont sous l'objectif. */
  surveys: number;
  belowTarget: number;
  /** Réclamations sur douze mois et sur les douze précédents. */
  complaints: number;
  complaintsPrevious: number;
}

/** Vue de pilotage de la satisfaction client. */
export async function getSatisfactionOverview(tx: TenantTx, today: string): Promise<SatisfactionOverview> {
  const surveys = await listCustomerSurveys(tx);
  const since = addMonthsIso(today, -SATISFACTION_WINDOW_MONTHS);
  const recent = surveys.filter((s) => s.closedOn > since && s.closedOn <= today);
  const complaints = await listComplaints(tx, addMonthsIso(today, -2 * SATISFACTION_WINDOW_MONTHS));
  const trend = complaintsTrend(complaints.map((c) => c.openedOn), today);
  return {
    lastNps: surveys.find((s) => s.method === 'nps') ?? null,
    lastCsat: surveys.find((s) => s.method === 'csat') ?? null,
    surveys: recent.length,
    belowTarget: recent.filter((s) => s.verdict === 'sous_objectif').length,
    complaints: trend.current,
    complaintsPrevious: trend.previous,
  };
}
