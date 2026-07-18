import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { getDashboardMetrics } from './dashboard.ts';

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
});
