import type { AttestationKind, SupplierAnswers, SupplierRating, SupplierRequestStatus } from '@toron/core';
import { date, foreignKey, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { contractStatus, supplierTier } from './enums.ts';
import { tenants, users } from './tenancy.ts';

// ── Section 4.7 — Tiers & fournisseurs (V1) ────────────────────────────
export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  tier: supplierTier('tier').notNull().default('t3'),
  services: text('services'),
  dataCategories: text('data_categories').array().notNull().default([]),
  contractStatus: contractStatus('contract_status').notNull().default('a_faire'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  nextReview: date('next_review'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierAssessments = pgTable('supplier_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  supplierId: uuid('supplier_id').notNull(),
  assessedOn: date('assessed_on').notNull().defaultNow(),
  assessorUserId: uuid('assessor_user_id').references(() => users.id),
  answers: jsonb('answers').notNull().$type<SupplierAnswers>(),
  score: smallint('score').notNull(),
  rating: text('rating').notNull().$type<SupplierRating>(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.supplierId, t.tenantId], foreignColumns: [suppliers.id, suppliers.tenantId] }).onDelete('cascade')]);

export const supplierAttestations = pgTable('supplier_attestations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  supplierId: uuid('supplier_id').notNull(),
  kind: text('kind').notNull().$type<AttestationKind>(),
  label: text('label'),
  issuedOn: date('issued_on'),
  validUntil: date('valid_until'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.supplierId, t.tenantId], foreignColumns: [suppliers.id, suppliers.tenantId] }).onDelete('cascade')]);

// Portail de réponse fournisseur (migration 0038) : le jeton du lien n'est
// jamais stocké, seulement son empreinte.
export const supplierRequests = pgTable('supplier_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  supplierId: uuid('supplier_id').notNull(),
  contactName: text('contact_name').notNull(),
  contactEmail: text('contact_email').notNull(),
  message: text('message'),
  tokenHash: text('token_hash').notNull(),
  status: text('status').notNull().default('envoyee').$type<SupplierRequestStatus>(),
  dueOn: date('due_on').notNull(),
  expiresOn: date('expires_on').notNull(),
  answers: jsonb('answers').notNull().default({}).$type<Partial<SupplierAnswers>>(),
  comments: jsonb('comments').notNull().default({}).$type<Record<string, string>>(),
  requestedBy: uuid('requested_by').references(() => users.id),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  assessmentId: uuid('assessment_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.supplierId, t.tenantId], foreignColumns: [suppliers.id, suppliers.tenantId] }).onDelete('cascade')]);
