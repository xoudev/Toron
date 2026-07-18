import {
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { riskBand, riskSource, riskTreatment } from './enums.ts';
import { controls } from './referentiels.ts';
import { scopes, tenants, users } from './tenancy.ts';

// ── Section 4.3 — Moteur de risques (registre manuel, MVP) ─────────────
// Le DDL opérant (RLS, droits append-only) vit dans les migrations *.sql ;
// ce schéma Drizzle est le miroir typé pour la couche d'accès.

// Échelle G/V versionnée par tenant (append-only ; active = version MAX).
export const riskScales = pgTable(
  'risk_scales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    version: integer('version').notNull(),
    size: integer('size').notNull().default(4),
    gLabels: jsonb('g_labels').notNull(),
    vLabels: jsonb('v_labels').notNull(),
    bands: jsonb('bands').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('risk_scales_tenant_version_unique').on(t.tenantId, t.version)],
);

export const risks = pgTable('risks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  scopeId: uuid('scope_id')
    .notNull()
    .references(() => scopes.id),
  title: text('title').notNull(),
  businessValue: text('business_value'),
  assetRef: uuid('asset_ref'),
  scenario: text('scenario'),
  source: riskSource('source').notNull().default('manual'),
  grossG: integer('gross_g').notNull(),
  grossV: integer('gross_v').notNull(),
  netG: integer('net_g').notNull(),
  netV: integer('net_v').notNull(),
  treatment: riskTreatment('treatment').notNull().default('reduire'),
  residualTarget: riskBand('residual_target'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  nextReview: date('next_review'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Acceptation formelle signée (première classe, immuable) — RM §5.4.
export const riskAcceptances = pgTable('risk_acceptances', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  riskId: uuid('risk_id')
    .notNull()
    .references(() => risks.id, { onDelete: 'cascade' }),
  acceptedByUser: uuid('accepted_by_user')
    .notNull()
    .references(() => users.id),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  rationale: text('rationale').notNull(),
  expiresAt: date('expires_at'),
});

export const riskControls = pgTable(
  'risk_controls',
  {
    riskId: uuid('risk_id')
      .notNull()
      .references(() => risks.id, { onDelete: 'cascade' }),
    controlId: uuid('control_id')
      .notNull()
      .references(() => controls.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.riskId, t.controlId] })],
);

// Instantané de cotation horodaté (append-only) : bandes calculées + version
// d'échelle figées au moment du rating (changer d'échelle n'altère rien).
export const riskHistory = pgTable('risk_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  riskId: uuid('risk_id')
    .notNull()
    .references(() => risks.id, { onDelete: 'cascade' }),
  grossG: integer('gross_g').notNull(),
  grossV: integer('gross_v').notNull(),
  grossBand: riskBand('gross_band').notNull(),
  netG: integer('net_g').notNull(),
  netV: integer('net_v').notNull(),
  netBand: riskBand('net_band').notNull(),
  scaleVersion: integer('scale_version').notNull(),
  ratedBy: uuid('rated_by').references(() => users.id),
  ratedAt: timestamp('rated_at', { withTimezone: true }).notNull().defaultNow(),
});
