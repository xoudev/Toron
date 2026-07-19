import {
  customType,
  date,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { documentType, documentVersionStatus } from './enums.ts';
import { processes } from './processes.ts';
import { requirements } from './referentiels.ts';
import { scopes, tenants, users } from './tenancy.ts';

// ── Section 4.5 — Gestion documentaire (MVP light) ─────────────────────
// Le DDL/RLS et le trigger d'immuabilité des versions publiées vivent dans
// les migrations *.sql.

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  type: documentType('type').notNull().default('autre'),
  title: text('title').notNull(),
  scopeId: uuid('scope_id').references(() => scopes.id),
  processId: uuid('process_id').references(() => processes.id, { onDelete: 'set null' }),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  reviewDue: date('review_due'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    semver: text('semver').notNull(),
    fileRef: text('file_ref'),
    fileName: text('file_name'),
    content: bytea('content'),
    body: text('body'),
    status: documentVersionStatus('status').notNull().default('brouillon'),
    createdBy: uuid('created_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('document_versions_doc_semver_unique').on(t.documentId, t.semver)],
);

export const documentRequirements = pgTable(
  'document_requirements',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.requirementId] })],
);
