import {
  LEADER_ROLES,
  leaderTrainingDue,
  leaderTrainingState,
  trainingSessionState,
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

/** Formation cybersécurité des dirigeants (NIS 2, art. 20) : dernière session « dirigeants » tenue. */
export async function listLeaderTraining(tx: TenantTx, today: string): Promise<LeaderTrainingRow[]> {
  const rows = (await tx.execute(sql`
    SELECT u.id AS user_id, u.name, m.role::text AS role,
           (SELECT max(s.held_on)::text FROM training_attendees a
              JOIN training_sessions s ON s.id = a.session_id
             WHERE a.user_id = u.id AND s.kind = 'formation_dirigeants' AND s.held_on <= ${today}) AS last_trained_on
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.role::text IN (${sql.join(LEADER_ROLES.map((r) => sql`${r}`), sql`, `)})
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
