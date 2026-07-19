import { integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { ebiosLikelihood, ebiosPhase, ebiosScenarioKind } from './enums.ts';
import { risks } from './risks.ts';
import { scopes, tenants } from './tenancy.ts';

// ── Section 5.4b — Ateliers EBIOS RM (V1, méthode ANSSI) ───────────────
export const ebiosStudies = pgTable('ebios_studies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  title: text('title').notNull(),
  scopeId: uuid('scope_id').references(() => scopes.id),
  workshop: smallint('workshop').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ebiosScenarios = pgTable('ebios_scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  studyId: uuid('study_id')
    .notNull()
    .references(() => ebiosStudies.id, { onDelete: 'cascade' }),
  kind: ebiosScenarioKind('kind').notNull().default('operationnel'),
  riskSource: text('risk_source').notNull(),
  targetObjective: text('target_objective').notNull(),
  likelihood: ebiosLikelihood('likelihood'),
  generatedRiskId: uuid('generated_risk_id').references(() => risks.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ebiosActions = pgTable('ebios_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  scenarioId: uuid('scenario_id')
    .notNull()
    .references(() => ebiosScenarios.id, { onDelete: 'cascade' }),
  phase: ebiosPhase('phase').notNull(),
  position: integer('position').notNull().default(0),
  mitreId: text('mitre_id'),
  mitreName: text('mitre_name'),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
