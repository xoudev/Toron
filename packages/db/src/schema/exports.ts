import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { exportStatus, exportType } from './enums.ts';
import { tenants, users } from './tenancy.ts';

// Type binaire Postgres pour le PDF scellé (stockage local MVP ; en prod,
// file_ref pointe l'Object Storage et pdf reste NULL).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ── Exports scellés — le poinçon (ADR-6, module 5.3c) ──────────────────
export const exports = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  type: exportType('type').notNull(),
  objectRef: uuid('object_ref'),
  status: exportStatus('status').notNull().default('en_cours'),
  fileRef: text('file_ref'),
  pdf: bytea('pdf'),
  sha256: text('sha256'),
  verifySlug: text('verify_slug'),
  error: text('error'),
  requestedBy: uuid('requested_by').references(() => users.id),
  sealedAt: timestamp('sealed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
