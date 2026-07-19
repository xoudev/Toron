import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { createSupplier, listSuppliers, updateSupplier } from './suppliers.ts';

const PG_IMAGE = 'postgres:16.14-alpine3.23';
const T = DEMO.tenantId;

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  const uri = container.getConnectionUri();
  await applyMigrations(uri);
  await seedRecyfFramework(uri);
  await seedIso27001Framework(uri);
  await seedDemoTenant(uri);
  admin = postgres(uri, { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;
  app = createDb(
    `postgres://app_login:app_login_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`,
  );
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

describe('registre fournisseurs (module 5.10)', () => {
  it('le seed pose 3 fournisseurs triés par criticité (T1 d’abord)', async () => {
    const list = await withTenant(app.db, T, (tx) => listSuppliers(tx));
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0]!.tier).toBe('t1');
    const heb = list.find((s) => s.id === DEMO.supplierHebergeur)!;
    expect(heb.contractStatus).toBe('conforme');
    expect(heb.dataCategories).toContain('Données clients');
  });

  it('création puis mise à jour du statut contractuel', async () => {
    const status = await withTenant(app.db, T, async (tx) => {
      const id = await createSupplier(tx, { tenantId: T, name: 'Test — SaaS', tier: 't2', dataCategories: ['Logs'] });
      await updateSupplier(tx, { supplierId: id, contractStatus: 'conforme' });
      return (await listSuppliers(tx)).find((s) => s.id === id)!.contractStatus;
    });
    expect(status).toBe('conforme');
  });

  it('isolation cross-tenant (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) => createSupplier(tx, { tenantId: T, name: 'Isolé', tier: 't3' }));
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers four', 'tiers-four') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listSuppliers(tx));
    expect(seen.some((s) => s.id === id)).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
