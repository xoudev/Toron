import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { PG_IMAGE } from '../test-image.ts';
import { withTenant } from '../tenant.ts';
import { acceptInvitation, createInvitation, isEmailMember, listInvitations, listPendingInvitationsForEmail, revokeInvitation } from './invitations.ts';
import { countOwners, listTenantMemberDetails, removeMember, updateMemberRole } from './members.ts';
import { createTenantWithOwner } from './organisation.ts';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;
let auth: DbHandle;
let ownerId: string;
let guestId: string;
let tenantA: { id: string; slug: string };
let tenantB: { id: string; slug: string };

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  await applyMigrations(container.getConnectionUri());
  admin = postgres(container.getConnectionUri(), { max: 1 });
  await admin`CREATE ROLE inv_app LOGIN PASSWORD 'test_app'`;
  await admin`GRANT toron_app TO inv_app`;
  await admin`CREATE ROLE inv_auth LOGIN PASSWORD 'test_auth'`;
  await admin`GRANT toron_auth TO inv_auth`;
  const host = `${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
  app = createDb(`postgres://inv_app:test_app@${host}`);
  auth = createDb(`postgres://inv_auth:test_auth@${host}`);
  const [owner] = await admin`INSERT INTO users (email, name) VALUES ('owner@example.test', 'Propriétaire') RETURNING id`;
  const [guest] = await admin`INSERT INTO users (email, name) VALUES ('Invitee@Example.test', 'Invitée') RETURNING id`;
  ownerId = owner!.id as string;
  guestId = guest!.id as string;
  tenantA = await createTenantWithOwner(auth.db, { name: 'Alpha', baseSlug: 'alpha', userId: ownerId, scopeName: 'SMSI', scopeKind: 'smsi' });
  tenantB = await createTenantWithOwner(auth.db, { name: 'Beta', baseSlug: 'beta', userId: ownerId, scopeName: 'QMS', scopeKind: 'qms' });
});

afterAll(async () => {
  await app?.close(); await auth?.close(); await admin?.end(); await container?.stop();
});

describe('invitations de membres', () => {
  it('crée une invitation dont seul le haché est stocké, puis l’accepte avec le bon compte', async () => {
    const created = await withTenant(app.db, tenantA.id, (tx) =>
      createInvitation(tx, { tenantId: tenantA.id, email: 'invitee@example.test', role: 'rssi', invitedBy: ownerId }));
    const [stored] = await admin`SELECT token_hash, email FROM invitations WHERE id = ${created.id}`;
    expect(stored!.token_hash).not.toContain(created.token);
    expect(stored!.email).toBe('invitee@example.test');

    const pending = await listPendingInvitationsForEmail(auth.db, 'INVITEE@example.test');
    expect(pending.map((p) => p.tenantSlug)).toEqual([tenantA.slug]);

    const wrongAccount = await acceptInvitation(auth.db, { token: created.token, userId: ownerId, sessionEmail: 'owner@example.test' });
    expect(wrongAccount.ok).toBe(false);

    const accepted = await acceptInvitation(auth.db, { token: created.token, userId: guestId, sessionEmail: 'Invitee@Example.test' });
    expect(accepted).toMatchObject({ ok: true, tenantSlug: tenantA.slug, role: 'rssi', alreadyMember: false });

    const members = await withTenant(app.db, tenantA.id, listTenantMemberDetails);
    expect(members.find((m) => m.userId === guestId)?.role).toBe('rssi');
    const again = await acceptInvitation(auth.db, { token: created.token, userId: guestId, sessionEmail: 'invitee@example.test' });
    expect(again.ok).toBe(false);
    const trace = await admin`SELECT action FROM audit_log WHERE tenant_id = ${tenantA.id} AND action = 'membership.accept_invitation'`;
    expect(trace).toHaveLength(1);
  });

  it('isole les invitations entre organisations et révoque proprement', async () => {
    const inB = await withTenant(app.db, tenantB.id, (tx) =>
      createInvitation(tx, { tenantId: tenantB.id, email: 'tiers@example.test', role: 'lecteur', invitedBy: ownerId }));
    expect((await withTenant(app.db, tenantA.id, listInvitations)).map((i) => i.id)).not.toContain(inB.id);
    expect(await withTenant(app.db, tenantA.id, (tx) => revokeInvitation(tx, inB.id))).toBe(false);
    expect(await withTenant(app.db, tenantB.id, (tx) => revokeInvitation(tx, inB.id))).toBe(true);
    const refused = await acceptInvitation(auth.db, { token: inB.token, userId: guestId, sessionEmail: 'tiers@example.test' });
    expect(refused.ok).toBe(false);
  });

  it('remplace une invitation en attente pour la même adresse et refuse un jeton inconnu', async () => {
    const first = await withTenant(app.db, tenantB.id, (tx) =>
      createInvitation(tx, { tenantId: tenantB.id, email: 'double@example.test', role: 'pilote', invitedBy: ownerId }));
    const second = await withTenant(app.db, tenantB.id, (tx) =>
      createInvitation(tx, { tenantId: tenantB.id, email: 'double@example.test', role: 'pilote', invitedBy: ownerId }));
    const rows = await withTenant(app.db, tenantB.id, listInvitations);
    expect(rows.find((r) => r.id === first.id)?.revokedAt).not.toBeNull();
    expect(rows.find((r) => r.id === second.id)?.revokedAt).toBeNull();
    expect((await acceptInvitation(auth.db, { token: 'jeton-inconnu', userId: guestId, sessionEmail: 'double@example.test' })).ok).toBe(false);
    expect(await withTenant(app.db, tenantA.id, (tx) => isEmailMember(tx, 'INVITEE@example.test'))).toBe(true);
    expect(await withTenant(app.db, tenantB.id, (tx) => isEmailMember(tx, 'invitee@example.test'))).toBe(false);
  });

  it('le rôle applicatif ne crée pas d’appartenance hors de son organisation', async () => {
    await expect(withTenant(app.db, tenantA.id, (tx) =>
      updateMemberRole(tx, { tenantId: tenantB.id, userId: ownerId, role: 'lecteur' }))).resolves.toBe(false);
    expect(await withTenant(app.db, tenantB.id, countOwners)).toBe(1);
  });

  it('met à jour et retire un membre dans l’organisation courante uniquement', async () => {
    expect(await withTenant(app.db, tenantA.id, (tx) => updateMemberRole(tx, { tenantId: tenantA.id, userId: guestId, role: 'auditeur' }))).toBe(true);
    expect((await withTenant(app.db, tenantA.id, listTenantMemberDetails)).find((m) => m.userId === guestId)?.role).toBe('auditeur');
    expect(await withTenant(app.db, tenantB.id, (tx) => removeMember(tx, { tenantId: tenantB.id, userId: guestId }))).toBe(false);
    expect(await withTenant(app.db, tenantA.id, (tx) => removeMember(tx, { tenantId: tenantA.id, userId: guestId }))).toBe(true);
    expect(await withTenant(app.db, tenantA.id, countOwners)).toBe(1);
  });
});
