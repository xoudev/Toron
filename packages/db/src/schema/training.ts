import type { TrainingKind } from '@toron/core';
import { date, foreignKey, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { evidences } from './evidences.ts';
import { tenants, users } from './tenancy.ts';

// ── Sensibilisation et formation (migration 0034) ──────────────────────
export const trainingSessions = pgTable('training_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  title: text('title').notNull(),
  kind: text('kind').notNull().$type<TrainingKind>(),
  heldOn: date('held_on').notNull(),
  durationMinutes: integer('duration_minutes'),
  audience: text('audience'),
  expectedCount: integer('expected_count'),
  attendedCount: integer('attended_count'),
  provider: text('provider'),
  notes: text('notes'),
  evidenceId: uuid('evidence_id'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('training_sessions_id_tenant_key').on(t.id, t.tenantId),
  foreignKey({ columns: [t.evidenceId, t.tenantId], foreignColumns: [evidences.id, evidences.tenantId] }),
]);

export const trainingAttendees = pgTable('training_attendees', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  sessionId: uuid('session_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.userId] }),
  foreignKey({ columns: [t.sessionId, t.tenantId], foreignColumns: [trainingSessions.id, trainingSessions.tenantId] }).onDelete('cascade'),
]);
