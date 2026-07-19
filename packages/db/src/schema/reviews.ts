import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { reviewStatus } from './enums.ts';
import { actions } from './actions.ts';
import { tenants, users } from './tenancy.ts';

// ── Section 5.9 — Revue de direction (V1, clause 9.3) ──────────────────
// Une seule revue couvre SMSI + QMS. L'ordre du jour (entrées 9.3.2) est
// calculé à l'affichage depuis les données réelles ; on persiste la séance,
// ses participants et ses décisions convertibles en actions.
export const managementReviews = pgTable('management_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  title: text('title').notNull(),
  scopeLabel: text('scope_label').notNull().default('SMSI + QMS'),
  status: reviewStatus('status').notNull().default('planifie'),
  heldAt: date('held_at'),
  nextReviewAt: date('next_review_at'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviewParticipants = pgTable('review_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => managementReviews.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviewDecisions = pgTable('review_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => managementReviews.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  actionId: uuid('action_id').references(() => actions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
