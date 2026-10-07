import type { ExceptionStatus } from '@toron/core';
import { date, foreignKey, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { assets } from './assets.ts';
import { controls } from './referentiels.ts';
import { tenants, users } from './tenancy.ts';

// ── Dérogations aux règles (migration 0032) ────────────────────────────
export const policyExceptions = pgTable('policy_exceptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  title: text('title').notNull(),
  rule: text('rule').notNull(),
  justification: text('justification').notNull(),
  compensatingMeasures: text('compensating_measures').notNull(),
  controlId: uuid('control_id'),
  assetId: uuid('asset_id'),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  startsOn: date('starts_on').notNull(),
  expiresOn: date('expires_on').notNull(),
  status: text('status').notNull().default('demandee').$type<ExceptionStatus>(),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  closedBy: uuid('closed_by').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closureNote: text('closure_note'),
  renewedFromId: uuid('renewed_from_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('policy_exceptions_id_tenant_key').on(t.id, t.tenantId),
  foreignKey({ columns: [t.controlId, t.tenantId], foreignColumns: [controls.id, controls.tenantId] }),
  foreignKey({ columns: [t.assetId, t.tenantId], foreignColumns: [assets.id, assets.tenantId] }),
  foreignKey({ columns: [t.renewedFromId, t.tenantId], foreignColumns: [t.id, t.tenantId] }),
]);
