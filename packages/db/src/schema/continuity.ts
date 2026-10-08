import type { ExerciseKind, ExerciseResult, ExerciseStatus } from '@toron/core';
import { date, foreignKey, integer, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { assets } from './assets.ts';
import { documents } from './documents.ts';
import { evidences } from './evidences.ts';
import { processes } from './processes.ts';
import { suppliers } from './suppliers.ts';
import { tenants, users } from './tenancy.ts';

// ── Continuité d'activité (migration 0035) ─────────────────────────────
export const continuityActivities = pgTable('continuity_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  description: text('description'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  processId: uuid('process_id'),
  criticality: smallint('criticality').notNull(),
  rtoHours: integer('rto_hours').notNull(),
  rpoHours: integer('rpo_hours').notNull(),
  degradedMode: text('degraded_mode'),
  planDocumentId: uuid('plan_document_id'),
  assessedOn: date('assessed_on').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('continuity_activities_id_tenant_key').on(t.id, t.tenantId),
  foreignKey({ columns: [t.processId, t.tenantId], foreignColumns: [processes.id, processes.tenantId] }),
  foreignKey({ columns: [t.planDocumentId, t.tenantId], foreignColumns: [documents.id, documents.tenantId] }),
]);

export const continuityActivityAssets = pgTable('continuity_activity_assets', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  activityId: uuid('activity_id').notNull(),
  assetId: uuid('asset_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.activityId, t.assetId] }),
  foreignKey({ columns: [t.activityId, t.tenantId], foreignColumns: [continuityActivities.id, continuityActivities.tenantId] }).onDelete('cascade'),
  foreignKey({ columns: [t.assetId, t.tenantId], foreignColumns: [assets.id, assets.tenantId] }).onDelete('cascade'),
]);

export const continuityActivitySuppliers = pgTable('continuity_activity_suppliers', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  activityId: uuid('activity_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.activityId, t.supplierId] }),
  foreignKey({ columns: [t.activityId, t.tenantId], foreignColumns: [continuityActivities.id, continuityActivities.tenantId] }).onDelete('cascade'),
  foreignKey({ columns: [t.supplierId, t.tenantId], foreignColumns: [suppliers.id, suppliers.tenantId] }).onDelete('cascade'),
]);

export const continuityExercises = pgTable('continuity_exercises', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  title: text('title').notNull(),
  kind: text('kind').notNull().$type<ExerciseKind>(),
  scheduledOn: date('scheduled_on').notNull(),
  status: text('status').notNull().$type<ExerciseStatus>().default('planifie'),
  result: text('result').$type<ExerciseResult>(),
  recoveryMinutes: integer('recovery_minutes'),
  findings: text('findings'),
  evidenceId: uuid('evidence_id'),
  leadUserId: uuid('lead_user_id').references(() => users.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('continuity_exercises_id_tenant_key').on(t.id, t.tenantId),
  foreignKey({ columns: [t.evidenceId, t.tenantId], foreignColumns: [evidences.id, evidences.tenantId] }),
]);

export const continuityExerciseActivities = pgTable('continuity_exercise_activities', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  exerciseId: uuid('exercise_id').notNull(),
  activityId: uuid('activity_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.exerciseId, t.activityId] }),
  foreignKey({ columns: [t.exerciseId, t.tenantId], foreignColumns: [continuityExercises.id, continuityExercises.tenantId] }).onDelete('cascade'),
  foreignKey({ columns: [t.activityId, t.tenantId], foreignColumns: [continuityActivities.id, continuityActivities.tenantId] }).onDelete('cascade'),
]);
