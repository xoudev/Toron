import type { SurveyMethod } from '@toron/core';
import { date, foreignKey, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { evidences } from './evidences.ts';
import { tenants, users } from './tenancy.ts';

// ── Satisfaction client (migration 0036) ───────────────────────────────
export const customerSurveys = pgTable('customer_surveys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  title: text('title').notNull(),
  method: text('method').notNull().$type<SurveyMethod>(),
  segment: text('segment'),
  closedOn: date('closed_on').notNull(),
  invitedCount: integer('invited_count'),
  respondents: integer('respondents').notNull(),
  promoters: integer('promoters'),
  passives: integer('passives'),
  detractors: integer('detractors'),
  satisfied: integer('satisfied'),
  target: integer('target'),
  findings: text('findings'),
  evidenceId: uuid('evidence_id'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.evidenceId, t.tenantId], foreignColumns: [evidences.id, evidences.tenantId] }),
]);
