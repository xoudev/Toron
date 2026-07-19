import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { incidentNotifKind, incidentSeverity, incidentStatus } from './enums.ts';
import { tenants, users } from './tenancy.ts';

// ── Section 4.7 — Incidents & chronologie NIS 2 (V1) ───────────────────
// Le DDL/RLS et les contraintes (REX à la clôture) vivent dans les migrations.

export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  title: text('title').notNull(),
  description: text('description'),
  severity: incidentSeverity('severity').notNull().default('mineur'),
  status: incidentStatus('status').notNull().default('ouvert'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
  nis2Important: boolean('nis2_important').notNull().default(false),
  nis2Criteria: jsonb('nis2_criteria'),
  gdprBreach: boolean('gdpr_breach').notNull().default(false),
  rex: text('rex'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const incidentEvents = pgTable('incident_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  authorUserId: uuid('author_user_id').references(() => users.id),
});

export const incidentNotifications = pgTable(
  'incident_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    kind: incidentNotifKind('kind').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    exportRef: uuid('export_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('incident_notifications_unique').on(t.incidentId, t.kind)],
);
