import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditStatus, findingType } from './enums.ts';
import { actions } from './actions.ts';
import { frameworks } from './referentiels.ts';
import { scopes, tenants, users } from './tenancy.ts';

// ── Section 5.8 — Audits internes (V1) ─────────────────────────────────
export const audits = pgTable('audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  title: text('title').notNull(),
  frameworkId: uuid('framework_id').references(() => frameworks.id),
  scopeId: uuid('scope_id').references(() => scopes.id),
  status: auditStatus('status').notNull().default('planifie'),
  plannedAt: date('planned_at'),
  leadAuditor: uuid('lead_auditor').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditFindings = pgTable('audit_findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  auditId: uuid('audit_id')
    .notNull()
    .references(() => audits.id, { onDelete: 'cascade' }),
  requirementRef: text('requirement_ref'),
  type: findingType('type').notNull().default('observation'),
  description: text('description').notNull(),
  actionId: uuid('action_id').references(() => actions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
