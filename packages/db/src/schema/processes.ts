import type { ProcessRequirement, ProcessInteraction, ProcessKpi, Sipoc } from '@toron/core';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { processFamily, processWorkflow } from './enums.ts';
import { risks } from './risks.ts';
import { tenants, users } from './tenancy.ts';

// ── Section 7.1 — Processus (V2, pack QMS) ─────────────────────────────
export const processes = pgTable('processes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  family: processFamily('family').notNull(),
  name: text('name').notNull(),
  pilotUserId: uuid('pilot_user_id').references(() => users.id),
  version: text('version').notNull().default('v1.0'),
  workflow: processWorkflow('workflow').notNull().default('brouillon'),
  sipoc: jsonb('sipoc').notNull().$type<Sipoc>().default({ suppliers: [], inputs: [], activities: [], outputs: [], clients: [] }),
  kpis: jsonb('kpis').notNull().$type<ProcessKpi[]>().default([]),
  coveredRequirements: jsonb('covered_requirements').notNull().$type<ProcessRequirement[]>().default([]),
  interactions: jsonb('interactions').notNull().$type<ProcessInteraction[]>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const processRisks = pgTable('process_risks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  processId: uuid('process_id')
    .notNull()
    .references(() => processes.id, { onDelete: 'cascade' }),
  riskId: uuid('risk_id')
    .notNull()
    .references(() => risks.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
