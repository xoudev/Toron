import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import { loadBoardReport } from './board.ts';
import { createExport, listExportsForObject, sealExport, verifyExport } from './exports.ts';

const T = DEMO.tenantId;
const TODAY = '2026-10-06';

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

describe('rapport de direction (module 5.11)', () => {
  it('assemble les registres du tenant démo', async () => {
    const r = await withTenant(app.db, T, (tx) => loadBoardReport(tx, TODAY));
    expect(r.organisationName).toBe('Meridiane Logistics');
    expect(r.headline).toContain('148 salariés');
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.entities[0]).toMatchObject({ name: 'Meridiane Logistics SAS', status: 'ei' });
    expect(r.input.processing).toMatchObject({ total: 5, incomplete: 2 });
    expect(r.decisions.some((d) => d.includes('art. 20'))).toBe(true);
    // Seed : la télémaintenance attend une décision, la rétention de Vitrolles est échue.
    expect(r.input.exceptions).toEqual({ pending: 1, lapsed: 1 });
    // Seed : sauvegardes inefficaces au dernier test ; MFA et inventaire en retard de revue.
    expect(r.input.controls).toEqual({ active: 3, late: 2, ineffective: 1 });
    expect(r.decisions).toContain('Arbitrer les moyens pour rétablir le contrôle jugé inefficace.');
    expect(r.decisions).toContain('Accorder ou refuser 1 demande de dérogation.');
    expect(r.messages).toContainEqual({ tone: 'alerte', text: '1 dérogation échue sans clôture : l’écart n’est plus couvert.' });
  });

  it('ignore les modules masqués par l’organisation', async () => {
    await admin`UPDATE tenants SET disabled_modules = ARRAY['risques','ebios','incidents','derogations']::text[] WHERE id = ${T}`;
    try {
      const r = await withTenant(app.db, T, (tx) => loadBoardReport(tx, TODAY));
      expect(r.input.risks).toBeNull();
      expect(r.input.incidents).toBeNull();
      expect(r.topRisks).toBeNull();
      expect(r.input.exceptions).toBeNull();
      expect(r.messages.some((m) => /risque|incident/i.test(m.text))).toBe(false);
    } finally {
      await admin`UPDATE tenants SET disabled_modules = '{}' WHERE id = ${T}`;
    }
  });

  it('isolation : une autre organisation ne voit que ses propres données', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers rapport', 'tiers-rapport') RETURNING id`;
    const r = await withTenant(app.db, (other as { id: string }).id, (tx) => loadBoardReport(tx, TODAY));
    expect(r.organisationName).toBe('Tiers rapport');
    expect(r.entities).toEqual([]);
    expect(r.input.obligations.applicable).toBe(0);
    expect(r.overdueActions).toEqual([]);
  });

  it('un rapport scellé se vérifie publiquement par son poinçon', async () => {
    const id = await withTenant(app.db, T, async (tx) => {
      const eid = await createExport(tx, { tenantId: T, type: 'rapport', objectRef: T, requestedBy: DEMO.userClaire });
      await sealExport(tx, { exportId: eid, pdf: Buffer.from('%PDF-test'), sha256: 'a'.repeat(64), verifySlug: 'rapport-test-slug' });
      return eid;
    });
    const listed = await withTenant(app.db, T, (tx) => listExportsForObject(tx, T));
    expect(listed.find((e) => e.id === id)).toMatchObject({ type: 'rapport', status: 'scelle' });
    expect(await verifyExport(app.db, 'rapport-test-slug')).toMatchObject({ type: 'rapport', sha256: 'a'.repeat(64) });
  });
});
