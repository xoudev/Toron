import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { addAction, addScenario, createStudy, generateRiskFromScenario, getStudy, listStudies } from './ebios.ts';

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
  app = createDb(`postgres://app_login:app_login_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

describe('ateliers EBIOS RM (module 5.4b)', () => {
  it('le seed pose une étude à l’atelier 4 avec ses scénarios opérationnels', async () => {
    const d = await withTenant(app.db, T, (tx) => getStudy(tx, DEMO.ebiosStudy));
    expect(d?.workshop).toBe(4);
    expect(d?.scenarios.length).toBe(3);
    const s1 = d?.scenarios.find((s) => s.riskSource === 'Cybercriminel organisé');
    expect(s1?.likelihood).toBe('v3');
    // Kill chain complète : quatre phases renseignées.
    expect(new Set(s1?.actions.map((a) => a.phase)).size).toBe(4);
  });

  it('la vraisemblance se dérive de la complétude de la kill chain', async () => {
    const l = await withTenant(app.db, T, async (tx) => {
      const studyId = await createStudy(tx, { tenantId: T, title: 'Test', scopeId: DEMO.scopeSmsi });
      const scId = await addScenario(tx, { tenantId: T, studyId, riskSource: 'SR', targetObjective: 'OV' });
      await addAction(tx, { tenantId: T, scenarioId: scId, phase: 'connaitre', label: 'a' });
      await addAction(tx, { tenantId: T, scenarioId: scId, phase: 'rentrer', label: 'b' });
      return addAction(tx, { tenantId: T, scenarioId: scId, phase: 'trouver', label: 'c' });
    });
    expect(l).toBe('v2'); // trois phases sur quatre
  });

  it('l’atelier 5 génère le risque dans le registre unique (source ebios)', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const riskId = await generateRiskFromScenario(tx, { tenantId: T, scenarioId: DEMO.ebiosSc1, scopeId: DEMO.scopeSmsi, ratedBy: DEMO.userClaire });
      const rows = (await tx.execute(sql`SELECT source, title FROM risks WHERE id = ${riskId}`)) as unknown as { source: string; title: string }[];
      const d = await getStudy(tx, DEMO.ebiosStudy);
      return { source: rows[0]?.source, title: rows[0]?.title, linked: d?.scenarios.find((s) => s.id === DEMO.ebiosSc1)?.generatedRiskId, riskId };
    });
    expect(res.source).toBe('ebios');
    expect(res.title).toContain('Cybercriminel');
    expect(res.linked).toBe(res.riskId);
  });

  it('isolation cross-tenant (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) => createStudy(tx, { tenantId: T, title: 'Isolée' }));
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers ebios', 'tiers-ebios') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listStudies(tx));
    expect(seen.some((s) => s.id === id)).toBe(false);
  });
});
