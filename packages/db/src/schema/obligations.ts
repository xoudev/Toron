import type { ObligationRegime, ObligationStatus } from '@toron/core';
import { date, foreignKey, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { legalEntities, tenants, users } from './tenancy.ts';

// ── Section 6.4 — Registre des obligations (V1) ────────────────────────
export const obligations = pgTable('obligations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  entityId: uuid('entity_id'),
  regime: text('regime').notNull().$type<ObligationRegime>(),
  catalogKey: text('catalog_key'),
  title: text('title').notNull(),
  source: text('source'),
  description: text('description'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  status: text('status').notNull().$type<ObligationStatus>().default('a_evaluer'),
  justification: text('justification'),
  dueDate: date('due_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.entityId, t.tenantId], foreignColumns: [legalEntities.id, legalEntities.tenantId] })]);
