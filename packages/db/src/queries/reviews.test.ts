import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  addDecision,
  addParticipant,
  convertDecisionToAction,
  createReview,
  getReview,
  getReviewCounts,
  listReviews,
} from './reviews.ts';

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

describe('revue de direction (module 5.9)', () => {
  it('le seed pose une revue tenue, 3 participants, 3 décisions dont une convertie', async () => {
    const d = await withTenant(app.db, T, (tx) => getReview(tx, DEMO.reviewS1));
    expect(d?.status).toBe('tenue');
    expect(d?.scopeLabel).toBe('SMSI + QMS');
    expect(d?.participants).toHaveLength(3);
    expect(d?.decisions).toHaveLength(3);
    expect(d?.actionCount).toBe(1);
    expect(d?.decisions.filter((x) => x.actionId !== null)).toHaveLength(1);
  });

  it('convertit une décision en action tracée (moteur commun, origin review)', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const reviewId = await createReview(tx, { tenantId: T, title: 'Test — revue', heldAt: '2026-02-01' });
      await addParticipant(tx, { tenantId: T, reviewId, userId: DEMO.userClaire });
      const decId = await addDecision(tx, { tenantId: T, reviewId, body: 'Décision à tracer.' });
      const actionId = await convertDecisionToAction(tx, { tenantId: T, decisionId: decId, reviewId, title: 'Suite de la décision', ownerUserId: DEMO.userClaire });
      const d = await getReview(tx, reviewId);
      const rows = (await tx.execute(
        sql`SELECT origin_type FROM actions WHERE id = ${actionId}`,
      )) as unknown as { origin_type: string }[];
      return { actionId, linked: d!.decisions.find((x) => x.id === decId)?.actionId, origin: rows[0]?.origin_type };
    });
    expect(res.linked).toBe(res.actionId);
    expect(res.origin).toBe('review');
  });

  it('les compteurs de l’ordre du jour reflètent les données du tenant', async () => {
    const counts = await withTenant(app.db, T, (tx) => getReviewCounts(tx));
    expect(counts.auditsInProgress).toBeGreaterThanOrEqual(1);
    expect(counts.ncOpen).toBeGreaterThanOrEqual(0);
    expect(typeof counts.incidentsOpen).toBe('number');
  });

  it('isolation cross-tenant (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) => createReview(tx, { tenantId: T, title: 'Isolée' }));
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers revue', 'tiers-revue') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listReviews(tx));
    expect(seen.some((r) => r.id === id)).toBe(false);
  });
});
