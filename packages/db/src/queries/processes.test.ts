import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { addProcessRisk, createProcess, getProcess, listProcesses, updateProcess } from './processes.ts';

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

describe('processus (module 7.1)', () => {
  it('le seed pose la cartographie QMS avec les trois familles', async () => {
    const list = await withTenant(app.db, T, (tx) => listProcesses(tx));
    expect(list.length).toBeGreaterThanOrEqual(8);
    const families = new Set(list.map((p) => p.family));
    expect(families.has('management')).toBe(true);
    expect(families.has('realisation')).toBe(true);
    expect(families.has('support')).toBe(true);
  });

  it('dérive la santé et la mutualisation depuis les données', async () => {
    const transport = await withTenant(app.db, T, (tx) => getProcess(tx, DEMO.processTransport));
    expect(transport?.name).toBe('Transport & livraison');
    // Deux indicateurs sous cible → à surveiller ; un contrôle 27001 mutualisé.
    expect(transport?.health).toBe('a_surveiller');
    expect(transport?.mutualizedCount).toBe(1);
    expect(transport?.sipoc.activities.length).toBeGreaterThan(0);
    // Risques rattachés au registre unique.
    expect(transport?.risks.length).toBe(2);
  });

  it('le SAV en alerte (indicateur critique)', async () => {
    const list = await withTenant(app.db, T, (tx) => listProcesses(tx));
    const sav = list.find((p) => p.name === 'Service après-vente');
    expect(sav?.health).toBe('en_alerte');
  });

  it('rattache un risque au processus (registre unique)', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const pid = await createProcess(tx, { tenantId: T, family: 'support', name: 'Test — processus', kpis: [] });
      await addProcessRisk(tx, { tenantId: T, processId: pid, riskId: DEMO.riskRancongiciel });
      return getProcess(tx, pid);
    });
    expect(res?.risks.some((r) => r.id === DEMO.riskRancongiciel)).toBe(true);
  });

  it('édite les blocs de la fiche (SIPOC, indicateurs, exigences)', async () => {
    const d = await withTenant(app.db, T, async (tx) => {
      const pid = await createProcess(tx, { tenantId: T, family: 'realisation', name: 'Test — édition' });
      await updateProcess(tx, pid, {
        sipoc: { suppliers: ['Amont'], inputs: ['Entrée'], activities: ['Étape'], outputs: ['Sortie'], clients: ['Aval'] },
        kpis: [{ label: 'Taux', actual: '95 %', target: '99 %', tone: 'warn' }],
        coveredRequirements: [{ framework: '27001', code: 'A.8.1', mutualized: true }],
      });
      return getProcess(tx, pid);
    });
    expect(d?.sipoc.suppliers).toEqual(['Amont']);
    expect(d?.kpis[0]?.actual).toBe('95 %');
    // Un indicateur orange → santé à surveiller ; exigence 27001 → mutualisation.
    expect(d?.health).toBe('a_surveiller');
    expect(d?.mutualizedCount).toBe(1);
  });

  it('isolation cross-tenant (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) => createProcess(tx, { tenantId: T, family: 'support', name: 'Isolé' }));
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers proc', 'tiers-proc') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listProcesses(tx));
    expect(seen.some((p) => p.id === id)).toBe(false);
  });
});
