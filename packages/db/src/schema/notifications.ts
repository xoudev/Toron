import type { NotificationSubject } from '@toron/core';
import { foreignKey, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { memberships, tenants, users } from './tenancy.ts';

// ── Section 4.8 — Notifications in-app (V1) ────────────────────────────
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull().$type<'assignation' | 'decision'>(),
  subject: text('subject').notNull().$type<NotificationSubject>(),
  title: text('title').notNull(),
  href: text('href').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId] }).onDelete('cascade')]);
