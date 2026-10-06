import type { LegalBasis } from '@toron/core';
import { boolean, date, foreignKey, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { suppliers } from './suppliers.ts';
import { legalEntities, tenants, users } from './tenancy.ts';

// ── Section 6.4 — Registre des activités de traitement (RGPD art. 30) ──
export const processingActivities = pgTable('processing_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  entityId: uuid('entity_id'),
  name: text('name').notNull(),
  purpose: text('purpose').notNull(),
  legalBasis: text('legal_basis').notNull().$type<LegalBasis>(),
  legalBasisDetail: text('legal_basis_detail'),
  dataSubjects: text('data_subjects').array().notNull().default([]),
  dataCategories: text('data_categories').array().notNull().default([]),
  sensitiveData: boolean('sensitive_data').notNull().default(false),
  recipients: text('recipients'),
  transfersOutsideEu: boolean('transfers_outside_eu').notNull().default(false),
  transferSafeguards: text('transfer_safeguards'),
  retention: text('retention'),
  securityMeasures: text('security_measures'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  lastReviewedOn: date('last_reviewed_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('processing_id_tenant_key').on(t.id, t.tenantId),
  foreignKey({ columns: [t.entityId, t.tenantId], foreignColumns: [legalEntities.id, legalEntities.tenantId] }),
]);

export const processingProcessors = pgTable('processing_processors', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  processingId: uuid('processing_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.processingId, t.supplierId] }),
  foreignKey({ columns: [t.processingId, t.tenantId], foreignColumns: [processingActivities.id, processingActivities.tenantId] }).onDelete('cascade'),
  foreignKey({ columns: [t.supplierId, t.tenantId], foreignColumns: [suppliers.id, suppliers.tenantId] }).onDelete('cascade'),
]);
