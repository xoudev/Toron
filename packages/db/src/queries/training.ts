import {
  awarenessSummary,
  leaderTrainingCounts,
  leaderTrainingDue,
  leaderTrainingState,
  ownersStandInForLeaders,
  trackedLeaderRoles,
  trainingSessionState,
  type AwarenessSummary,
  type LeaderTrainingCounts,
  type LeaderTrainingState,
  type MembershipRole,
  type TrainingKind,
  type TrainingSessionState,
} from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Sensibilisation et formation (migration 0034) ──────────────────────
// Opère sur une TenantTx (RLS active). Les salariés sont comptés ; seuls
// les membres de l'organisation apparaissent nommément.

export interface TrainingSessionRow {
  id: string;
  title: string;
  kind: TrainingKind;
  heldOn: string;
  durationMinutes: number | null;
  audience: string | null;
  expectedCount: number | null;
  attendedCount: number | null;
  provider: string | null;
  notes: string | null;
  evidenceId: string | null;
  evidenceTitle: string | null;
  /** Membres présents ; nom absent si la personne a quitté l'organisation. */
  attendees: { userId: string; name: string | null }[];
  state: TrainingSessionState;
}

interface RawSession {
  id: string;
  title: string;
  kind: TrainingKind;
  held_on: string;
  duration_minutes: number | null;
  audience: string | null;
  expected_count: number | null;
  attended_count: number | null;
  provider: string | null;
  notes: string | null;
  evidence_id: string | null;
  evidence_title: string | null;
  attendees: unknown;
}

/** Sessions de l'organisation, les plus récentes d'abord, avec leurs membres présents. */
export async function listTrainingSessions(tx: TenantTx, today: string): Promise<TrainingSessionRow[]> {
  const rows = (await tx.execute(sql`
    SELECT s.id, s.title, s.kind, s.held_on::text AS held_on, s.duration_minutes, s.audience,
           s.expected_count, s.attended_count, s.provider, s.notes, s.evidence_id, ev.title AS evidence_title,
           coalesce((
             SELECT json_agg(json_build_object('userId', a.user_id, 'name', u.name) ORDER BY u.name)
             FROM training_attendees a LEFT JOIN users u ON u.id = a.user_id
             WHERE a.session_id = s.id
           ), '[]'::json) AS attendees
    FROM training_sessions s
    LEFT JOIN evidences ev ON ev.id = s.evidence_id
    ORDER BY s.held_on DESC, s.created_at DESC
  `)) as unknown as RawSession[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    heldOn: r.held_on,
    durationMinutes: r.duration_minutes,
    audience: r.audience,
    expectedCount: r.expected_count,
    attendedCount: r.attended_count,
    provider: r.provider,
    notes: r.notes,
    evidenceId: r.evidence_id,
    evidenceTitle: r.evidence_title,
    attendees: (typeof r.attendees === 'string' ? JSON.parse(r.attendees) : r.attendees) as { userId: string; name: string | null }[],
    state: trainingSessionState(r.held_on, today),
  }));
}

export interface TrainingSessionInput {
  title: string;
  kind: TrainingKind;
  heldOn: string;
  durationMinutes: number | null;
  audience: string | null;
  expectedCount: number | null;
  attendedCount: number | null;
  provider: string | null;
  notes: string | null;
  evidenceId: string | null;
}

async function setAttendees(tx: TenantTx, tenantId: string, sessionId: string, userIds: readonly string[]): Promise<void> {
  await tx.delete(schema.trainingAttendees).where(eq(schema.trainingAttendees.sessionId, sessionId));
  const unique = [...new Set(userIds)];
  if (unique.length > 0) {
    await tx.insert(schema.trainingAttendees).values(unique.map((userId) => ({ tenantId, sessionId, userId })));
  }
}

/** Enregistre une session et ses membres présents. Renvoie son id. */
export async function createTrainingSession(
  tx: TenantTx,
  input: TrainingSessionInput & { tenantId: string; createdBy: string },
  attendeeIds: readonly string[],
): Promise<string> {
  const [row] = await tx.insert(schema.trainingSessions).values(input).returning({ id: schema.trainingSessions.id });
  await setAttendees(tx, input.tenantId, row!.id, attendeeIds);
  return row!.id;
}

/** Met à jour une session et remplace ses membres présents. Renvoie le nombre de lignes. */
export async function updateTrainingSession(
  tx: TenantTx,
  tenantId: string,
  sessionId: string,
  input: TrainingSessionInput,
  attendeeIds: readonly string[],
): Promise<number> {
  const updated = await tx
    .update(schema.trainingSessions)
    .set(input)
    .where(eq(schema.trainingSessions.id, sessionId))
    .returning({ id: schema.trainingSessions.id });
  if (updated.length > 0) await setAttendees(tx, tenantId, sessionId, attendeeIds);
  return updated.length;
}

export interface TrainingSessionRef {
  title: string;
  kind: TrainingKind;
  heldOn: string;
  expectedCount: number | null;
  attendedCount: number | null;
  evidenceId: string | null;
  attendeeIds: string[];
}

/** Ce qu'il faut d'une session pour la modifier, la supprimer ou la tracer ; null si elle n'existe pas. */
export async function getTrainingSessionRef(tx: TenantTx, sessionId: string): Promise<TrainingSessionRef | null> {
  const [row] = (await tx.execute(sql`
    SELECT s.title, s.kind, s.held_on::text AS held_on, s.expected_count, s.attended_count, s.evidence_id,
           coalesce(array_agg(a.user_id ORDER BY a.user_id) FILTER (WHERE a.user_id IS NOT NULL), '{}') AS attendee_ids
    FROM training_sessions s
    LEFT JOIN training_attendees a ON a.session_id = s.id
    WHERE s.id = ${sessionId}
    GROUP BY s.id
  `)) as unknown as {
    title: string; kind: TrainingKind; held_on: string; expected_count: number | null; attended_count: number | null;
    evidence_id: string | null; attendee_ids: string[];
  }[];
  if (!row) return null;
  return {
    title: row.title,
    kind: row.kind,
    heldOn: row.held_on,
    expectedCount: row.expected_count,
    attendedCount: row.attended_count,
    evidenceId: row.evidence_id,
    attendeeIds: row.attendee_ids,
  };
}

/** Rattache une feuille d'émargement du coffre de preuves. Renvoie le nombre de lignes. */
export async function setTrainingSessionEvidence(tx: TenantTx, sessionId: string, evidenceId: string): Promise<number> {
  const updated = await tx
    .update(schema.trainingSessions)
    .set({ evidenceId })
    .where(eq(schema.trainingSessions.id, sessionId))
    .returning({ id: schema.trainingSessions.id });
  return updated.length;
}

/** Supprime une session (ses présences suivent). Renvoie son intitulé, ou null si elle n'existe pas. */
export async function deleteTrainingSession(tx: TenantTx, sessionId: string): Promise<{ title: string } | null> {
  const [row] = await tx
    .delete(schema.trainingSessions)
    .where(eq(schema.trainingSessions.id, sessionId))
    .returning({ title: schema.trainingSessions.title });
  return row ?? null;
}

export interface LeaderTrainingRow {
  userId: string;
  name: string;
  role: MembershipRole;
  lastTrainedOn: string | null;
  dueOn: string | null;
  state: LeaderTrainingState;
}

/**
 * Rôles suivis comme dirigeants dans l'organisation courante : la direction,
 * à défaut le propriétaire (règle du cœur, trackedLeaderRoles).
 */
export async function listLeaderRoles(tx: TenantTx): Promise<MembershipRole[]> {
  const rows = (await tx.execute(sql`SELECT DISTINCT role::text AS role FROM memberships`)) as unknown as { role: MembershipRole }[];
  return trackedLeaderRoles(rows.map((r) => r.role));
}

/** Formation cybersécurité des dirigeants (NIS 2, art. 20) : dernière session « dirigeants » tenue. */
export async function listLeaderTraining(tx: TenantTx, today: string): Promise<LeaderTrainingRow[]> {
  const leaderRoles = await listLeaderRoles(tx);
  const rows = (await tx.execute(sql`
    SELECT u.id AS user_id, u.name, m.role::text AS role,
           (SELECT max(s.held_on)::text FROM training_attendees a
              JOIN training_sessions s ON s.id = a.session_id
             WHERE a.user_id = u.id AND s.kind = 'formation_dirigeants' AND s.held_on <= ${today}) AS last_trained_on
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.role::text IN (${sql.join(leaderRoles.map((r) => sql`${r}`), sql`, `)})
    ORDER BY u.name
  `)) as unknown as { user_id: string; name: string; role: MembershipRole; last_trained_on: string | null }[];
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    role: r.role,
    lastTrainedOn: r.last_trained_on,
    dueOn: r.last_trained_on ? leaderTrainingDue(r.last_trained_on) : null,
    state: leaderTrainingState(r.last_trained_on, today),
  }));
}

export type TrainingOverview = AwarenessSummary & LeaderTrainingCounts & {
  /** Aucun membre Direction : le propriétaire est suivi comme dirigeant à sa place. */
  ownersAsLeaders: boolean;
};

/** Bilan sur douze mois et formation des dirigeants, pour le tableau de bord, le rapport et la revue. */
export async function getTrainingOverview(tx: TenantTx, today: string): Promise<TrainingOverview> {
  const summary = awarenessSummary(await listTrainingSessions(tx, today), today);
  const rows = await listLeaderTraining(tx, today);
  const leaders = leaderTrainingCounts(rows.map((l) => l.state));
  return { ...summary, ...leaders, ownersAsLeaders: ownersStandInForLeaders(rows.map((l) => l.role)) };
}
