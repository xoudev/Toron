import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from './migrate.ts';

/**
 * Séparation des rôles d'authentification (M0-3, ADR-4/S5) :
 * - toron_auth : identités globales, sessions, résolution tenant/membership ;
 * - toron_app : AUCUN droit sur les tables d'auth, isolation RLS inchangée.
 */

const PG_IMAGE = 'postgres:16.14-alpine3.23';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let authSql: postgres.Sql;
let appSql: postgres.Sql;
let tenantA: string;
let userA: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  await applyMigrations(container.getConnectionUri());
  admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE auth_login LOGIN PASSWORD 'auth_login_test'`;
  await admin`GRANT toron_auth TO auth_login`;
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const dbName = container.getDatabase();
  authSql = postgres(`postgres://auth_login:auth_login_test@${host}:${port}/${dbName}`, {
    max: 1,
    onnotice: () => {},
  });
  appSql = postgres(`postgres://app_login:app_login_test@${host}:${port}/${dbName}`, {
    max: 1,
    onnotice: () => {},
  });
});

afterAll(async () => {
  await authSql?.end();
  await appSql?.end();
  await admin?.end();
  await container?.stop();
});

describe('rôle toron_auth', () => {
  it("crée un utilisateur, un tenant avec slug et le membership owner (parcours d'inscription)", async () => {
    const [u] = await authSql`
      INSERT INTO users (email, name) VALUES ('claire.morel@meridiane.example', 'Claire Morel')
      RETURNING id`;
    userA = (u as { id: string }).id;
    const [t] = await authSql`
      INSERT INTO tenants (name, slug) VALUES ('Meridiane Logistics', 'meridiane-logistics')
      RETURNING id`;
    tenantA = (t as { id: string }).id;
    await authSql`
      INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantA}, ${userA}, 'owner')`;

    const membership = await authSql`
      SELECT m.role FROM memberships m
      JOIN tenants t ON t.id = m.tenant_id
      WHERE t.slug = 'meridiane-logistics' AND m.user_id = ${userA}`;
    expect(membership).toHaveLength(1);
    expect((membership[0] as { role: string }).role).toBe('owner');
  });

  it('gère les sessions et le TOTP (tables Better Auth)', async () => {
    await authSql`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${userA}, 'jeton-de-session-test', now() + interval '7 days')`;
    await authSql`
      INSERT INTO two_factors (user_id, secret, backup_codes)
      VALUES (${userA}, 'secret-chiffre', 'codes-chiffres')`;
    const sessions = await authSql`SELECT user_id FROM sessions`;
    expect(sessions).toHaveLength(1);
  });

  it('ne peut PAS toucher aux données métier (controls, scopes…)', async () => {
    await expect(
      authSql`INSERT INTO controls (tenant_id, title) VALUES (${tenantA}, 'intrusion')`,
    ).rejects.toThrow(/permission denied/);
    await expect(authSql`SELECT * FROM controls`).rejects.toThrow(/permission denied/);
  });

  it('ne peut ni modifier ni supprimer un tenant', async () => {
    await expect(
      authSql`UPDATE tenants SET name = 'Renommé' WHERE id = ${tenantA}`,
    ).rejects.toThrow(/permission denied/);
    await expect(authSql`DELETE FROM tenants WHERE id = ${tenantA}`).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('rôle toron_app face aux tables d’auth', () => {
  it("n'a aucun accès aux sessions, accounts, verifications, two_factors", async () => {
    for (const table of ['sessions', 'accounts', 'verifications', 'two_factors']) {
      await expect(appSql.unsafe(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
    }
  });
});
