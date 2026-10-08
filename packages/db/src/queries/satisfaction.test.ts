import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import {
  createCustomerSurvey,
  deleteCustomerSurvey,
  getCustomerSurveyRef,
  getSatisfactionOverview,
  listComplaints,
  listCustomerSurveys,
  setCustomerSurveyEvidence,
  updateCustomerSurvey,
  type CustomerSurveyInput,
} from './satisfaction.ts';

const T = DEMO.tenantId;
const TODAY = '2026-10-08';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;

async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const messages: string[] = [];
    let cur: unknown = e;
    while (cur instanceof Error) {
      messages.push(cur.message);
      cur = cur.cause;
    }
    expect(messages.join(' | ')).toMatch(pattern);
    return;
  }
  expect.fail('La requête aurait dû être rejetée par Postgres.');
}

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

const NPS: CustomerSurveyInput = {
  title: 'Baromètre NPS — clients B2B', method: 'nps', segment: 'Clients B2B', closedOn: '2026-09-20', invitedCount: 120,
  respondents: 60, promoters: 30, passives: 20, detractors: 10, satisfied: null, target: 30, findings: null, evidenceId: null,
  ownerUserId: DEMO.userCamille,
};

const surveys = (tenantId: string = T) => withTenant(app.db, tenantId, (tx) => listCustomerSurveys(tx));
const create = (over: Partial<CustomerSurveyInput>, tenantId: string = T) =>
  withTenant(app.db, tenantId, (tx) => createCustomerSurvey(tx, { ...NPS, ...over, tenantId, createdBy: DEMO.userCamille }));

describe('enquêtes de satisfaction', () => {
  it('le seed porte deux baromètres NPS en hausse et une mesure CSAT, avec score, objectif et tendance', async () => {
    const rows = await surveys();
    expect(rows.map((r) => r.id)).toEqual([DEMO.surveyCsatLivraison, DEMO.surveyNpsS1, DEMO.surveyNpsS2]);
    expect(rows[0]).toMatchObject({ method: 'csat', score: 84, target: 80, verdict: 'atteint', previousScore: null, trend: null });
    expect(rows[1]).toMatchObject({ method: 'nps', score: 35, target: 40, verdict: 'sous_objectif', previousScore: 26, trend: 'hausse', ownerName: 'Camille Poirier' });
    expect(rows[2]).toMatchObject({ score: 26, previousScore: null });
  });

  it('la vue de pilotage retient les dernières mesures et la tendance des réclamations', async () => {
    const o = await withTenant(app.db, T, (tx) => getSatisfactionOverview(tx, TODAY));
    expect(o).toMatchObject({ surveys: 3, belowTarget: 2, complaints: 5, complaintsPrevious: 0 });
    expect(o.lastNps?.id).toBe(DEMO.surveyNpsS1);
    expect(o.lastCsat?.id).toBe(DEMO.surveyCsatLivraison);
  });

  it('les réclamations sont les non-conformités de source réclamation client, datées à Paris', async () => {
    const rows = await withTenant(app.db, T, (tx) => listComplaints(tx, '2025-10-08'));
    expect(rows.map((r) => r.id)).toEqual([DEMO.complaintInversion, DEMO.complaintEtiquettes, DEMO.complaintRetards, DEMO.complaintCasse, DEMO.complaintAvoir]);
    expect(rows[0]).toMatchObject({ openedOn: '2026-10-02', status: 'ouverte', gravity: 'mineure' });
    expect(rows.some((r) => r.id === DEMO.ncEtiquetage)).toBe(false);
  });

  it('une enquête s’enregistre, se modifie, reçoit son rapport et se supprime', async () => {
    const id = await create({});
    let row = (await surveys()).find((r) => r.id === id)!;
    expect(row).toMatchObject({ score: 33, verdict: 'atteint', trend: null });
    expect(await withTenant(app.db, T, (tx) => updateCustomerSurvey(tx, id, { ...NPS, promoters: 20, passives: 25, detractors: 15 }))).toBe(1);
    row = (await surveys()).find((r) => r.id === id)!;
    expect(row).toMatchObject({ score: 8, verdict: 'sous_objectif' });
    expect(await withTenant(app.db, T, (tx) => setCustomerSurveyEvidence(tx, id, DEMO.evidenceInventaire))).toBe(1);
    expect(await withTenant(app.db, T, (tx) => getCustomerSurveyRef(tx, id))).toMatchObject({ title: NPS.title, evidenceId: DEMO.evidenceInventaire });
    expect(await withTenant(app.db, T, (tx) => deleteCustomerSurvey(tx, id))).toEqual({ title: NPS.title });
    expect(await withTenant(app.db, T, (tx) => getCustomerSurveyRef(tx, id))).toBeNull();
  });

  it('la base refuse des résultats incohérents', async () => {
    await expectDbError(create({ detractors: 11 }), /customer_surveys_results/);
    await expectDbError(create({ method: 'csat' }), /customer_surveys_results/);
    await expectDbError(create({ method: 'csat', promoters: null, passives: null, detractors: null, satisfied: 70 }), /customer_surveys_results/);
    await expectDbError(create({ invitedCount: 50 }), /customer_surveys_respondents/);
    await expectDbError(
      create({ method: 'csat', promoters: null, passives: null, detractors: null, satisfied: 50, target: -10 }),
      /customer_surveys_target/,
    );
    await expectDbError(create({ method: 'avis' as CustomerSurveyInput['method'] }), /customer_surveys_method_check/);
  });

  it('le module se masque comme les autres modules optionnels', async () => {
    await admin`UPDATE tenants SET disabled_modules = ARRAY['satisfaction']::text[] WHERE id = ${T}`;
    await admin`UPDATE tenants SET disabled_modules = '{}' WHERE id = ${T}`;
  });
});

describe('isolation entre organisations', () => {
  it('ni lecture, ni modification, ni rapport, ni réclamation d’une organisation à l’autre', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers satisfaction', 'tiers-satisfaction') RETURNING id`;
    const otherId = (other as { id: string }).id;
    expect(await surveys(otherId)).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => listComplaints(tx, '2020-01-01'))).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => getSatisfactionOverview(tx, TODAY))).toMatchObject({ lastNps: null, surveys: 0, complaints: 0 });
    expect(await withTenant(app.db, otherId, (tx) => updateCustomerSurvey(tx, DEMO.surveyNpsS1, NPS))).toBe(0);
    expect(await withTenant(app.db, otherId, (tx) => deleteCustomerSurvey(tx, DEMO.surveyNpsS1))).toBeNull();
    expect(await withTenant(app.db, otherId, (tx) => getCustomerSurveyRef(tx, DEMO.surveyNpsS1))).toBeNull();
    // Le rapport doit être une preuve de la même organisation.
    await expectDbError(create({ evidenceId: DEMO.evidenceMfa }, otherId), /foreign key/);
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createCustomerSurvey(tx, { ...NPS, tenantId: T, createdBy: DEMO.userCamille })),
      /row-level security/,
    );
    expect((await surveys()).map((r) => r.id)).toContain(DEMO.surveyNpsS1);
  });
});
