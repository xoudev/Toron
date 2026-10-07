import type { ControlReviewMethod, ControlReviewResult } from '@toron/core';
import { date, foreignKey, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { evidences } from './evidences.ts';
import { controls } from './referentiels.ts';
import { tenants, users } from './tenancy.ts';

// ── Revues d'efficacité des contrôles (migration 0033) ─────────────────
export const controlReviews = pgTable('control_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  controlId: uuid('control_id').notNull(),
  reviewedOn: date('reviewed_on').notNull(),
  reviewerUserId: uuid('reviewer_user_id').notNull().references(() => users.id),
  method: text('method').notNull().$type<ControlReviewMethod>(),
  result: text('result').notNull().$type<ControlReviewResult>(),
  observations: text('observations'),
  evidenceId: uuid('evidence_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.controlId, t.tenantId], foreignColumns: [controls.id, controls.tenantId] }).onDelete('cascade'),
  foreignKey({ columns: [t.evidenceId, t.tenantId], foreignColumns: [evidences.id, evidences.tenantId] }),
]);
