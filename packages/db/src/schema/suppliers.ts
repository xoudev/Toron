import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
