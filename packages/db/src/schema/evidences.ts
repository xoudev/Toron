import { customType, date, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { actionLinkTarget, evidenceAccessKind, evidenceRecurrence, evidenceType } from './enums.ts';
import { tenants, users } from './tenancy.ts';

// ── Section 4.5 — Coffre de preuves (MVP) ──────────────────────────────
// Le DDL/RLS vit dans les migrations *.sql.

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const evidences = pgTable('evidences', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  title: text('title').notNull(),
  type: evidenceType('type').notNull().default('export'),
  fileRef: text('file_ref'),
  fileName: text('file_name'),
  content: bytea('content'),
  sha256: text('sha256').notNull(),
  collectedAt: date('collected_at').notNull(),
  validUntil: date('valid_until'),
  recurrence: evidenceRecurrence('recurrence').notNull().default('ponctuelle'),
  collectorUserId: uuid('collector_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceLinks = pgTable(
  'evidence_links',
  {
    evidenceId: uuid('evidence_id')
      .notNull()
      .references(() => evidences.id, { onDelete: 'cascade' }),
    targetType: actionLinkTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.evidenceId, t.targetType, t.targetId] })],
);

export const evidenceAccessLog = pgTable('evidence_access_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  evidenceId: uuid('evidence_id')
    .notNull()
    .references(() => evidences.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  kind: evidenceAccessKind('kind').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
