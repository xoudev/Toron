import {
  boolean,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { actionLinkTarget, actionOrigin, actionPriority, actionStatus } from './enums.ts';
import { tenants, users } from './tenancy.ts';

// ── Section 4.4 — Plan d'action unifié (P2) ───────────────────────────
// « en_retard » n'est pas un statut stocké : il se calcule à partir de
// due_date (RM §5.5). Le DDL/RLS vit dans les migrations *.sql.

export const actions = pgTable('actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  title: text('title').notNull(),
  description: text('description'),
  originType: actionOrigin('origin_type').notNull().default('manual'),
  originId: uuid('origin_id'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  dueDate: date('due_date'),
  priority: actionPriority('priority').notNull().default('p2'),
  effort: integer('effort'),
  status: actionStatus('status').notNull().default('planifie'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const actionLinks = pgTable(
  'action_links',
  {
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    targetType: actionLinkTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.actionId, t.targetType, t.targetId] })],
);

export const actionSubtasks = pgTable('action_subtasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  actionId: uuid('action_id')
    .notNull()
    .references(() => actions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  done: boolean('done').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const actionComments = pgTable('action_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  actionId: uuid('action_id')
    .notNull()
    .references(() => actions.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => users.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
