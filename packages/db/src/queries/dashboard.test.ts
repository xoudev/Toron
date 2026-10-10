import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { getDashboardExtras, getDashboardMetrics } from './dashboard.ts';
import { listFrameworks, setFrameworkHidden } from './referentiels.ts';
import { PG_IMAGE } from '../test-image.ts';

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

describe('indicateurs du tableau de bord (module 5.11)', () => {
  it('agrège les données du tenant démo', async () => {
    const m = await withTenant(app.db, T, (tx) => getDashboardMetrics(tx));
    // Seed : 2 référentiels actifs sur le SMSI, 3 contrôles tous mutualisés.
    expect(m.frameworksActive).toBe(2);
    expect(m.controlsTotal).toBe(3);
    expect(m.controlsMutualized).toBe(3);
    // 5 risques ; au moins un en acceptation à traiter (inventaire non signé).
    expect(m.risksTotal).toBe(5);
    expect(m.risksAttention).toBeGreaterThanOrEqual(1);
    const bandTotal = Object.values(m.risksByBand).reduce((a, b) => a + b, 0);
    expect(bandTotal).toBe(5);
    // Plan de traitement : la compromission de compte à privilèges n'a aucune action,
    // les deux risques acceptés relèvent de l'acceptation signée.
    expect(Object.values(m.risksByPlan).reduce((a, b) => a + b, 0)).toBe(5);
    expect(m.risksByPlan.non_planifie).toBeGreaterThanOrEqual(1);
    expect(m.risksByPlan.sans_objet).toBe(2);
    // Une action à échéance dépassée (revue des accès).
    expect(m.actionsOverdue).toBeGreaterThanOrEqual(1);
    // Une preuve expirée/bientôt (attestation MFA) ; un document à revoir.
    expect(m.evidencesStale).toBeGreaterThanOrEqual(1);
    expect(m.documentsReviewOverdue).toBeGreaterThanOrEqual(1);
  });

  it('isolation : un tenant vierge n’agrège rien', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers kpi', 'tiers-kpi') RETURNING id`;
    const m = await withTenant(app.db, (other as { id: string }).id, (tx) => getDashboardMetrics(tx));
    expect(m.risksTotal).toBe(0);
    expect(m.controlsTotal).toBe(0);
    expect(m.coveragePct).toBeNull();
  });

  it('documents : distingue ceux à publier et ceux sans date de revue', async () => {
    // Seed : PSSI et procédure publiées, toutes deux avec une date de revue.
    const demo = await withTenant(app.db, T, (tx) => getDashboardMetrics(tx));
    expect(demo.documentsUnpublished).toBe(0);
    expect(demo.documentsWithoutReviewDate).toBe(0);

    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers docs', 'tiers-docs') RETURNING id`;
    const tid = (other as { id: string }).id;
    await admin`INSERT INTO documents (tenant_id, type, title) VALUES (${tid}, 'pssi', 'PSSI à rédiger')`;
    const m = await withTenant(app.db, tid, (tx) => getDashboardMetrics(tx));
    expect(m.documentsTotal).toBe(1);
    expect(m.documentsUnpublished).toBe(1);
    expect(m.documentsWithoutReviewDate).toBe(1);
    expect(m.documentsReviewOverdue).toBe(0);
  });
});

describe('compteurs complémentaires du tableau de bord', () => {
  it('le catalogue compte les exigences feuilles des référentiels visibles, comme ses cartes', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers catalogue', 'tiers-catalogue') RETURNING id`;
    const tid = (other as { id: string }).id;
    const frameworks = await withTenant(app.db, tid, (tx) => listFrameworks(tx));
    const cards = frameworks.reduce((n, f) => n + f.leafRequirementCount, 0);
    expect((await withTenant(app.db, tid, (tx) => getDashboardExtras(tx))).requirementsTotal).toBe(cards);

    // Un référentiel masqué disparaît du catalogue et de son total.
    const iso = frameworks.find((f) => f.code === 'iso27001')!;
    await withTenant(app.db, tid, (tx) => setFrameworkHidden(tx, tid, iso.id, true));
    expect((await withTenant(app.db, tid, (tx) => getDashboardExtras(tx))).requirementsTotal).toBe(cards - iso.leafRequirementCount);
  });

  it('compte les actions et les actifs, registres repris à l’import', async () => {
    const demo = await withTenant(app.db, T, (tx) => getDashboardExtras(tx));
    expect(demo.actionsTotal).toBeGreaterThan(0);
    expect(demo.assetsTotal).toBeGreaterThan(0);
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers registres', 'tiers-registres') RETURNING id`;
    const blank = await withTenant(app.db, (other as { id: string }).id, (tx) => getDashboardExtras(tx));
    expect(blank.actionsTotal).toBe(0);
    expect(blank.assetsTotal).toBe(0);
  });
});
