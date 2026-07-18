import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from './client.ts';
import { applyMigrations } from './migrate.ts';
import * as schema from './schema/index.ts';
import {
  DEMO,
  seedDemoTenant,
  seedIso27001Framework,
  seedRecyfFramework,
} from './seed.ts';
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
  await seedIso27001Framework(uri);
  await seedDemoTenant(uri);
  // Seconde exécution : les seeds doivent être idempotents.
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

  it('mappe les 3 contrôles internes à la fois sur ReCyF et sur ISO 27001', async () => {
    const links = await withTenant(app.db, DEMO.tenantId, (tx) =>
      tx
        .select({ ref: schema.requirements.refId })
        .from(schema.controlRequirements)
        .innerJoin(
          schema.requirements,
          eq(schema.requirements.id, schema.controlRequirements.requirementId),
        ),
    );
    expect(links.map((l) => l.ref).sort()).toEqual([
      'A.5.9',
      'A.8.13',
      'A.8.5',
      'OBJ-01',
      'OBJ-08',
      'OBJ-13',
    ]);
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

describe('seed ISO/IEC 27001:2022', () => {
  it('charge les clauses 4-10 et les 93 contrôles de l’Annexe A', async () => {
    const [counts] = await admin`
      SELECT
        count(*) FILTER (WHERE r.ref_id ~ '^A\\.[5-8]\\.[0-9]+$') AS controles_annexe_a,
        count(*) FILTER (WHERE r.ref_id ~ '^(4|5|6|7|8|9|10)$') AS clauses_racines
      FROM requirements r
      JOIN frameworks f ON f.id = r.framework_id
      WHERE f.code = 'iso27001' AND f.tenant_id IS NULL`;
    expect(Number((counts as { controles_annexe_a: string }).controles_annexe_a)).toBe(93);
    expect(Number((counts as { clauses_racines: string }).clauses_racines)).toBe(7);
  });

  it('rattache chaque contrôle Annexe A à son thème parent (A.5.19 → A.5)', async () => {
    const [row] = await admin`
      SELECT p.ref_id AS theme
      FROM requirements r
      JOIN requirements p ON p.id = r.parent_id
      JOIN frameworks f ON f.id = r.framework_id
      WHERE f.code = 'iso27001' AND f.tenant_id IS NULL AND r.ref_id = 'A.5.19'`;
    expect((row as { theme: string }).theme).toBe('A.5');
  });
});

describe('mutualisation (le cœur du produit, P1)', () => {
  it('les 3 contrôles couvrent 2 référentiels et remontent dans mutualized_controls', async () => {
    const rows = await withTenant(app.db, DEMO.tenantId, (tx) =>
      tx.execute(
        dsql`SELECT control_id, framework_count FROM mutualized_controls ORDER BY control_id`,
      ),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows as unknown as { framework_count: number }[]) {
      expect(Number(row.framework_count)).toBe(2);
    }
  });

  it('la vue reste isolée : un autre tenant ne voit aucune mutualisation', async () => {
    const [other] = await admin`
      INSERT INTO tenants (name, slug) VALUES ('Tiers sans lien', 'tiers-sans-lien') RETURNING id`;
    const rows = await withTenant(app.db, (other as { id: string }).id, (tx) =>
      tx.execute(dsql`SELECT control_id FROM mutualized_controls`),
    );
    expect(rows).toHaveLength(0);
  });
});
