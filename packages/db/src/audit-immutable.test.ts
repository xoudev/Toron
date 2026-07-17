import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeAuditEntry } from './audit.js';
import { createDb, type DbHandle } from './client.js';
import { applyMigrations } from './migrate.js';
import { withTenant } from './tenant.js';

/**
 * Immuabilité du journal d'audit (M0-4, S6/§8.2) : INSERT only pour TOUS
 * les rôles — y compris le superutilisateur propriétaire de la table.
 */

const PG_IMAGE = 'postgres:16.14-alpine3.23';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;
let tenantId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  await applyMigrations(container.getConnectionUri());
  admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;

  const [t] = await admin`
    INSERT INTO tenants (name, slug) VALUES ('Tenant Journal', 'tenant-journal') RETURNING id`;
  tenantId = (t as { id: string }).id;

  const appUri = `postgres://app_login:app_login_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
  app = createDb(appUri);

  await withTenant(app.db, tenantId, (tx) =>
    writeAuditEntry(tx, {
      tenantId,
      action: 'scope.create',
      objectType: 'scope',
      after: { name: 'SMSI Groupe' },
    }),
  );
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

describe('audit_log immuable pour tous les rôles', () => {
  it("l'entrée écrite via writeAuditEntry est bien journalisée", async () => {
    const rows = await admin`SELECT action, object_type FROM audit_log`;
    expect(rows).toHaveLength(1);
    expect((rows[0] as { action: string }).action).toBe('scope.create');
  });

  it('même le superutilisateur ne peut pas modifier une entrée', async () => {
    await expect(admin`UPDATE audit_log SET action = 'falsifié'`).rejects.toThrow(
      /audit_log est immuable/,
    );
  });

  it('même le superutilisateur ne peut pas supprimer une entrée', async () => {
    await expect(admin`DELETE FROM audit_log`).rejects.toThrow(/audit_log est immuable/);
  });

  it('TRUNCATE est bloqué', async () => {
    await expect(admin`TRUNCATE audit_log`).rejects.toThrow(/audit_log est immuable/);
  });

  it("le rôle d'authentification peut journaliser (INSERT) mais pas lire", async () => {
    await admin`CREATE ROLE auth_login LOGIN PASSWORD 'auth_login_test'`;
    await admin`GRANT toron_auth TO auth_login`;
    const authSql = postgres(
      `postgres://auth_login:auth_login_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`,
      { max: 1, onnotice: () => {} },
    );
    try {
      await authSql`
        INSERT INTO audit_log (tenant_id, action, object_type)
        VALUES (${tenantId}, 'tenant.create', 'tenant')`;
      await expect(authSql`SELECT * FROM audit_log`).rejects.toThrow(/permission denied/);
    } finally {
      await authSql.end();
    }
  });
});
