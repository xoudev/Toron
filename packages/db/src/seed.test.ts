import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from './client.ts';
import { applyMigrations } from './migrate.ts';
import * as schema from './schema/index.ts';
import { DEMO, seedDemoTenant, seedRecyfFramework } from './seed.ts';
import { withTenant } from './tenant.ts';

/** Seeds M0-6 : ReCyF complet + tenant démo, idempotents, visibles côté rôle applicatif. */

const PG_IMAGE = 'postgres:16.14-alpine3.23';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  const uri = container.getConnectionUri();
  await applyMigrations(uri);
  await seedRecyfFramework(uri);
  await seedDemoTenant(uri);
  // Seconde exécution : les seeds doivent être idempotents.
  await seedRecyfFramework(uri);
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

describe('seed ReCyF v2.5', () => {
  it('charge les 20 objectifs et les 152 moyens en arbre (172 exigences)', async () => {
    const [counts] = await admin`
      SELECT
        count(*) FILTER (WHERE parent_id IS NULL) AS objectifs,
        count(*) FILTER (WHERE parent_id IS NOT NULL) AS moyens
      FROM requirements r
      JOIN frameworks f ON f.id = r.framework_id
      WHERE f.code = 'recyf' AND f.tenant_id IS NULL`;
    expect(Number((counts as { objectifs: string }).objectifs)).toBe(20);
    expect(Number((counts as { moyens: string }).moyens)).toBe(152);
  });

  it('est idempotent (pas de doublon après double exécution)', async () => {
    const fw = await admin`SELECT id FROM frameworks WHERE code = 'recyf'`;
    expect(fw).toHaveLength(1);
    const [t] = await admin`SELECT count(*) AS n FROM tenants WHERE slug = ${DEMO.slug}`;
    expect(Number((t as { n: string }).n)).toBe(1);
  });

  it('expose le référentiel builtin au rôle applicatif du tenant démo', async () => {
    const rows = await withTenant(app.db, DEMO.tenantId, (tx) =>
      tx
        .select({ ref: schema.requirements.refId })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'OBJ-08')),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('tenant démo Meridiane Logistics', () => {
  it('porte l’organisation attendue : 1 entité, 3 sites, 2 périmètres, 3 membres', async () => {
    const result = await withTenant(app.db, DEMO.tenantId, async (tx) => ({
      sites: await tx.select().from(schema.sites),
      scopes: await tx.select().from(schema.scopes),
      memberships: await tx.select().from(schema.memberships),
    }));
    expect(result.sites).toHaveLength(3);
    expect(result.scopes.map((s) => s.kind).sort()).toEqual(['qms', 'smsi']);
    expect(result.memberships.map((m) => m.role).sort()).toEqual([
      'direction',
      'resp_qualite',
      'rssi',
    ]);
  });

  it('mappe les 3 contrôles internes sur les objectifs ReCyF réels', async () => {
    const links = await withTenant(app.db, DEMO.tenantId, (tx) =>
      tx
        .select({ ref: schema.requirements.refId, title: schema.controls.title })
        .from(schema.controlRequirements)
        .innerJoin(schema.controls, eq(schema.controls.id, schema.controlRequirements.controlId))
        .innerJoin(
          schema.requirements,
          eq(schema.requirements.id, schema.controlRequirements.requirementId),
        ),
    );
    expect(links.map((l) => l.ref).sort()).toEqual(['OBJ-01', 'OBJ-08', 'OBJ-13']);
  });

  it('crée des comptes de connexion Better Auth (argon2id) pour les 3 utilisateurs', async () => {
    const accounts = await admin`
      SELECT a.password FROM accounts a
      JOIN users u ON u.id = a.user_id
      WHERE a.provider_id = 'credential' AND u.email LIKE '%@meridiane-logistics.example'`;
    expect(accounts).toHaveLength(3);
    for (const row of accounts) {
      expect((row as { password: string }).password).toMatch(/^\$argon2id\$/);
    }
  });

  it('reste invisible depuis un autre tenant (isolation inchangée)', async () => {
    const [other] = await admin`
      INSERT INTO tenants (name, slug) VALUES ('Autre PME', 'autre-pme') RETURNING id`;
    const rows = await withTenant(app.db, (other as { id: string }).id, (tx) =>
      tx.select().from(schema.controls),
    );
    expect(rows).toHaveLength(0);
  });
});
