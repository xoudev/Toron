import { parseAssetsCsv } from '@toron/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  bulkCreateAssets,
  createAsset,
  linkAssetRisk,
  listAssetRiskIds,
  listAssets,
  unlinkAssetRisk,
} from './assets.ts';

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

describe('inventaire & DICP', () => {
  it('le seed démo pose 4 actifs, triés par sensibilité décroissante', async () => {
    const list = await withTenant(app.db, T, (tx) => listAssets(tx));
    expect(list.length).toBeGreaterThanOrEqual(4);
    // Le premier a la sensibilité maximale de la liste.
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1]!.sensitivity).toBeGreaterThanOrEqual(list[i]!.sensitivity);
    }
    const wms = list.find((a) => a.id === DEMO.assetServeurs)!;
    expect(wms.category).toBe('logiciel');
    expect(wms.sensitivity).toBe(4); // max(4,3,2,2)
  });

  it('la contrainte refuse une cotation DICP hors 1-4', async () => {
    let rejected = false;
    try {
      await withTenant(app.db, T, (tx) =>
        createAsset(tx, { tenantId: T, name: 'Bad', category: 'flux', dicpD: 9, dicpI: 1, dicpC: 1, dicpP: 1 }),
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

describe('import CSV', () => {
  it('parse un CSV et insère en lot', async () => {
    const csv = [
      'name,category,description,d,i,c,p',
      'Poste de travail direction,materiel,Portable RSSI,2,2,3,2',
      'Sauvegarde hors site,donnees,,3,4,4,4',
    ].join('\n');
    const parsed = parseAssetsCsv(csv);
    expect(parsed.errors).toHaveLength(0);
    const count = await withTenant(app.db, T, (tx) => bulkCreateAssets(tx, T, parsed.rows));
    expect(count).toBe(2);
    const list = await withTenant(app.db, T, (tx) => listAssets(tx));
    expect(list.some((a) => a.name === 'Sauvegarde hors site' && a.sensitivity === 4)).toBe(true);
  });
});

describe('lien actif ↔ risque', () => {
  it('rattache puis détache un risque', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const id = await createAsset(tx, { tenantId: T, name: 'Actif test', category: 'logiciel', dicpD: 2, dicpI: 2, dicpC: 2, dicpP: 2 });
      await linkAssetRisk(tx, { tenantId: T, assetId: id, riskId: DEMO.riskRancongiciel });
      const linkedBefore = await listAssetRiskIds(tx, id);
      const removed = await unlinkAssetRisk(tx, { assetId: id, riskId: DEMO.riskRancongiciel });
      const linkedAfter = await listAssetRiskIds(tx, id);
      return { linkedBefore, removed, linkedAfter };
    });
    expect(res.linkedBefore).toContain(DEMO.riskRancongiciel);
    expect(res.removed).toBe(1);
    expect(res.linkedAfter).toHaveLength(0);
  });
});

describe('isolation', () => {
  it('les actifs d’un tenant sont invisibles d’un autre (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) =>
      createAsset(tx, { tenantId: T, name: 'Actif isolé', category: 'flux', dicpD: 1, dicpI: 1, dicpC: 1, dicpP: 1 }),
    );
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers actif', 'tiers-actif') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listAssets(tx));
    expect(seen.some((a) => a.id === id)).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
