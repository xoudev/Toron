import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  assessmentItemStatus,
  assessmentStatus,
  controlStatus,
  frameworkSource,
  reviewFrequency,
} from './enums.js';
import { scopes, tenants, users } from './tenancy.js';

// ── Section 4.2 — Moteur de référentiels (le cœur) ────────────────────
// frameworks/requirements : tenant_id NULL = référentiel « builtin »
// visible par tous les tenants (lecture seule pour le rôle applicatif) ;
// tenant_id non NULL = référentiel custom, isolé par RLS.
// Rappel P4 : title_internal / guidance_internal = reformulations maison.

export const frameworks = pgTable(
  'frameworks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    code: text('code').notNull(),
    version: text('version').notNull(),
    name: text('name').notNull(),
    source: frameworkSource('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('frameworks_code_version_unique').on(t.tenantId, t.code, t.version)],
);

export const requirements = pgTable(
  'requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    frameworkId: uuid('framework_id')
      .notNull()
      .references(() => frameworks.id),
    refId: text('ref_id').notNull(),
    parentId: uuid('parent_id'),
    titleInternal: text('title_internal').notNull(),
    guidanceInternal: text('guidance_internal'),
    applicableDefault: boolean('applicable_default').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('requirements_framework_ref_unique').on(t.frameworkId, t.refId)],
);

export const controls = pgTable('controls', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  title: text('title').notNull(),
  description: text('description'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  reviewFrequency: reviewFrequency('review_frequency'),
  status: controlStatus('status').notNull().default('actif'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// La table de mutualisation : un contrôle couvre N exigences,
// potentiellement sur plusieurs référentiels (P1).
export const controlRequirements = pgTable(
  'control_requirements',
  {
    controlId: uuid('control_id')
      .notNull()
      .references(() => controls.id, { onDelete: 'cascade' }),
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.controlId, t.requirementId] })],
);

// Activation d'un référentiel par périmètre (§5.2).
export const scopeFrameworks = pgTable(
  'scope_frameworks',
  {
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.id, { onDelete: 'cascade' }),
    frameworkId: uuid('framework_id')
      .notNull()
      .references(() => frameworks.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scopeId, t.frameworkId] })],
);

export const assessments = pgTable('assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  frameworkId: uuid('framework_id')
    .notNull()
    .references(() => frameworks.id),
  scopeId: uuid('scope_id')
    .notNull()
    .references(() => scopes.id),
  campaignLabel: text('campaign_label').notNull(),
  status: assessmentStatus('status').notNull().default('planifiee'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assessmentItems = pgTable(
  'assessment_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => requirements.id),
    status: assessmentItemStatus('status').notNull().default('a_evaluer'),
    statement: text('statement'),
    soaIncluded: boolean('soa_included').notNull().default(true),
    // Obligatoire si non_applicable — CHECK en base (RM §5.3, S2).
    soaJustification: text('soa_justification'),
    assessedBy: uuid('assessed_by').references(() => users.id),
    assessedAt: timestamp('assessed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('assessment_items_assessment_req_unique').on(t.assessmentId, t.requirementId)],
);
