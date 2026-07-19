import { date, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { ncGravity, ncSource, ncStatus } from './enums.ts';
import { tenants, users } from './tenancy.ts';

// ── Section 7.2 — Non-conformités & CAPA (pack QMS) ────────────────────
// Le DDL/RLS et la contrainte de cohérence vivent dans les migrations.

export const nonconformities = pgTable('nonconformities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  title: text('title').notNull(),
  description: text('description'),
  source: ncSource('source').notNull().default('interne'),
  processRef: text('process_ref'),
  gravity: ncGravity('gravity').notNull().default('mineure'),
  costEstimate: numeric('cost_estimate', { precision: 12, scale: 2 }),
  immediateAction: text('immediate_action'),
  rootCause: jsonb('root_cause'),
  status: ncStatus('status').notNull().default('ouverte'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  detectedBy: uuid('detected_by').references(() => users.id),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  effectivenessCheckAt: date('effectiveness_check_at'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
