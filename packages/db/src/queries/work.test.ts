import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { WORK_KINDS } from '@toron/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import { listMyWork } from './work.ts';

const T = DEMO.tenantId;
const OTHER = 'e0000000-0000-4000-8000-000000000001';

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
  await admin`CREATE ROLE work_app LOGIN PASSWORD 'work_app_test'`;
  await admin`GRANT toron_app TO work_app`;
  app = createDb(`postgres://work_app:work_app_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`);

  // Une seconde organisation dont Claire est aussi membre, avec une action à elle.
  await admin`INSERT INTO tenants (id, name, slug) VALUES (${OTHER}, 'Autre organisation', 'autre-organisation')`;
  await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${OTHER}, ${DEMO.userClaire}, 'contributeur')`;
  await admin`INSERT INTO actions (tenant_id, title, origin_type, owner_user_id, due_date)
              VALUES (${OTHER}, 'Action d’une autre organisation', 'manual', ${DEMO.userClaire}, '2020-01-01')`;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

describe('Mon travail', () => {
  it('rassemble les éléments assignés dans plusieurs modules', async () => {
    const items = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userClaire));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(WORK_KINDS).toContain(i.kind);
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.detail.length).toBeGreaterThan(0);
      if (i.due) expect(i.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(new Set(items.map((i) => i.kind)).size).toBeGreaterThan(1);
  });

  it('ne montre jamais le travail d’une autre organisation', async () => {
    const demo = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userClaire));
    expect(demo.map((i) => i.title)).not.toContain('Action d’une autre organisation');
    const other = await withTenant(app.db, OTHER, (tx) => listMyWork(tx, DEMO.userClaire));
    expect(other.map((i) => i.title)).toEqual(['Action d’une autre organisation']);
  });

  it('exclut les actions terminées et ne renvoie rien à un membre sans affectation', async () => {
    const closed = await withTenant(app.db, T, async (tx) => {
      const items = await listMyWork(tx, DEMO.userClaire);
      return items.filter((i) => i.kind === 'action').length;
    });
    const [{ n }] = (await admin`SELECT count(*)::int AS n FROM actions WHERE tenant_id = ${T} AND owner_user_id = ${DEMO.userClaire} AND status <> 'termine'`) as unknown as [{ n: number }];
    expect(closed).toBe(n);
    const nobody = await withTenant(app.db, T, (tx) => listMyWork(tx, '00000000-0000-4000-8000-000000000000'));
    expect(nobody).toEqual([]);
  });
});
