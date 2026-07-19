import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { addFinding, convertFindingToAction, createAudit, getAudit, listAudits } from './audits.ts';

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

describe('audits internes (module 5.8)', () => {
  it('le seed pose un audit SMSI en cours avec ses constats (dont une NC)', async () => {
    const d = await withTenant(app.db, T, (tx) => getAudit(tx, DEMO.auditSmsi));
    expect(d?.status).toBe('en_cours');
    expect(d?.findingCount).toBe(3);
    expect(d?.ncCount).toBe(1);
    expect(d?.findings.some((f) => f.type === 'nc_mineure')).toBe(true);
  });

  it('convertit un constat en action corrective (moteur commun, origin finding)', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const auditId = await createAudit(tx, { tenantId: T, title: 'Test — audit', leadAuditor: DEMO.userAntoine });
      const fId = await addFinding(tx, { tenantId: T, auditId, type: 'nc_majeure', description: 'Écart critique.' });
      const actionId = await convertFindingToAction(tx, { tenantId: T, findingId: fId, auditId, title: 'Corriger l’écart critique', ownerUserId: DEMO.userAntoine });
      const d = await getAudit(tx, auditId);
      return { actionId, linked: d!.findings.find((f) => f.id === fId)?.actionId };
    });
    expect(res.linked).toBe(res.actionId);
  });

  it('isolation cross-tenant (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) => createAudit(tx, { tenantId: T, title: 'Isolé' }));
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers audit', 'tiers-audit') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listAudits(tx));
    expect(seen.some((a) => a.id === id)).toBe(false);
  });
});
