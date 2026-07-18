import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { assetCategory } from './enums.ts';
import { risks } from './risks.ts';
import { scopes, tenants, users } from './tenancy.ts';

// ── Section 6.3 — Actifs & cartographie (MVP minimal) ──────────────────
// Le DDL/RLS vit dans les migrations *.sql.

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  category: assetCategory('category').notNull().default('materiel'),
  description: text('description'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  scopeId: uuid('scope_id').references(() => scopes.id),
  dicpD: integer('dicp_d').notNull().default(1),
  dicpI: integer('dicp_i').notNull().default(1),
  dicpC: integer('dicp_c').notNull().default(1),
  dicpP: integer('dicp_p').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assetRisks = pgTable(
  'asset_risks',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    riskId: uuid('risk_id')
      .notNull()
      .references(() => risks.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.riskId] })],
);
