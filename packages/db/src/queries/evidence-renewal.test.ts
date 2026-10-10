import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import { getDashboardMetrics } from './dashboard.ts';
import { listEvidenceHistory, listEvidenceLinks, listEvidences, renewEvidence } from './evidences.ts';
import { listMyWork } from './work.ts';

const T = DEMO.tenantId;
const OTHER = 'e0000000-0000-4000-8000-000000000004';
const SHA = (c: string) => c.repeat(64);

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
  await admin`CREATE ROLE renew_app LOGIN PASSWORD 'renew_app_test'`;
  await admin`GRANT toron_app TO renew_app`;
  app = createDb(`postgres://renew_app:renew_app_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`);
  await admin`INSERT INTO tenants (id, name, slug) VALUES (${OTHER}, 'Autre', 'autre-renew')`;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

const old = DEMO.evidenceMfa;
const renew = (tenant: string, previousId: string, sha: string) => withTenant(app.db, tenant, (tx) => renewEvidence(tx, {
  tenantId: tenant, previousId, fileName: 'mfa-2026-t4.pdf', content: Buffer.from('%PDF-1.7 renouvellement'),
  sha256: sha, collectedAt: '2026-10-06', validUntil: '2027-01-06', collectorUserId: DEMO.userClaire,
}));

describe('renouvellement des preuves', () => {
  it('crée une preuve qui hérite des rattachements et remplace l’ancienne', async () => {
    const linksBefore = await withTenant(app.db, T, (tx) => listEvidenceLinks(tx, old));
    const staleBefore = (await withTenant(app.db, T, getDashboardMetrics)).evidencesStale;

    const res = await renew(T, old, SHA('a'));
    expect(res.outcome).toBe('renouvelee');
    if (res.outcome !== 'renouvelee') return;

    const linksAfter = await withTenant(app.db, T, (tx) => listEvidenceLinks(tx, res.evidenceId));
    expect(linksAfter.map((l) => l.targetId).sort()).toEqual(linksBefore.map((l) => l.targetId).sort());

    const list = await withTenant(app.db, T, listEvidences);
    expect(list.find((e) => e.id === old)?.supersededById).toBe(res.evidenceId);
    expect(list.find((e) => e.id === res.evidenceId)).toMatchObject({ supersededById: null, validUntil: '2027-01-06', freshness: 'fraiche' });
    // L'historique passe après les preuves en vigueur.
    expect(list.findIndex((e) => e.id === old)).toBeGreaterThan(list.findIndex((e) => e.id === res.evidenceId));

    const staleAfter = (await withTenant(app.db, T, getDashboardMetrics)).evidencesStale;
    expect(staleAfter).toBe(staleBefore - 1);
    const work = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userClaire));
    expect(work.some((i) => i.kind === 'preuve' && i.id === old)).toBe(false);

    const history = await withTenant(app.db, T, (tx) => listEvidenceHistory(tx, res.evidenceId));
    expect(history.map((h) => h.id)).toEqual([old]);
  });

  it('refuse de remplacer deux fois la même preuve et garde la chaîne complète', async () => {
    const again = await renew(T, old, SHA('b'));
    expect(again.outcome).toBe('deja_remplacee');
    const current = (await withTenant(app.db, T, listEvidences)).find((e) => e.id !== old && e.title && e.supersededById === null && e.sha256 === SHA('a'))!;
    const third = await renew(T, current.id, SHA('c'));
    expect(third.outcome).toBe('renouvelee');
    if (third.outcome !== 'renouvelee') return;
    const history = await withTenant(app.db, T, (tx) => listEvidenceHistory(tx, third.evidenceId));
    expect(history.map((h) => h.id)).toEqual([current.id, old]);
  });

  it('ne renouvelle pas la preuve d’une autre organisation', async () => {
    const res = await renew(OTHER, DEMO.evidenceInventaire, SHA('d'));
    expect(res.outcome).toBe('introuvable');
    const [row] = await admin`SELECT superseded_by FROM evidences WHERE id = ${DEMO.evidenceInventaire}`;
    expect(row!.superseded_by).toBeNull();
  });

  it('sans échéance saisie, la validité suit la récurrence héritée', async () => {
    const res = await withTenant(app.db, T, (tx) => renewEvidence(tx, {
      tenantId: T, previousId: DEMO.evidenceFormationDirigeants, fileName: 'attestations-2026.pdf',
      content: Buffer.from('%PDF-1.7 attestations'), sha256: SHA('e'), collectedAt: '2026-10-06', validUntil: null,
      collectorUserId: DEMO.userClaire,
    }));
    expect(res).toMatchObject({ outcome: 'renouvelee', validUntil: '2027-10-06' });
    if (res.outcome !== 'renouvelee') return;
    const renewed = (await withTenant(app.db, T, listEvidences)).find((e) => e.id === res.evidenceId);
    expect(renewed).toMatchObject({ recurrence: 'annuelle', validUntil: '2027-10-06', freshness: 'fraiche' });
  });
});
