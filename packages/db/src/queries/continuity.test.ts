import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import {
  createContinuityActivity,
  createContinuityExercise,
  deleteContinuityActivity,
  deleteContinuityExercise,
  getContinuityOverview,
  listContinuityActivities,
  listContinuityExercises,
  updateContinuityActivity,
  updateContinuityExercise,
  type ContinuityActivityInput,
  type ContinuityExerciseInput,
} from './continuity.ts';

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

const ACTIVITY: ContinuityActivityInput = {
  name: 'Réception des marchandises', description: null, ownerUserId: DEMO.userAntoine, processId: null,
  criticality: 3, rtoHours: 24, rpoHours: 8, degradedMode: 'Contrôle des livraisons sur bordereaux papier.',
  planDocumentId: null, assessedOn: '2026-09-01',
};

const EXERCISE: ContinuityExerciseInput = {
  title: 'Test de restauration du serveur de quai', kind: 'restauration', scheduledOn: '2026-09-30',
  status: 'realise', result: 'atteint', recoveryMinutes: 90, findings: null, evidenceId: null, leadUserId: DEMO.userClaire,
};

const activities = (tenantId: string = T) => withTenant(app.db, tenantId, (tx) => listContinuityActivities(tx, TODAY));

describe('bilan d’impact des activités critiques', () => {
  it('le seed porte quatre activités, les plus critiques d’abord, avec dépendances et dernier exercice', async () => {
    const rows = await activities();
    expect(rows.map((r) => r.id)).toEqual([DEMO.continuityExpedition, DEMO.continuityTournees, DEMO.continuityEdi, DEMO.continuityPaie]);
    expect(rows[0]).toMatchObject({
      criticality: 4, rtoHours: 8, rpoHours: 1, ownerName: 'Antoine Vasseur', processId: DEMO.processPrepa,
      state: 'partiel', nextExerciseOn: '2026-11-20',
      lastExercise: { id: DEMO.exerciseTableWms, heldOn: '2026-05-14', result: 'partiel', recoveryMinutes: null },
    });
    expect(rows[0]!.assets.map((a) => a.id).sort()).toEqual([DEMO.assetServeurs, DEMO.assetWms].sort());
    expect(rows[0]!.suppliers).toHaveLength(2);
    expect(rows.find((r) => r.id === DEMO.continuityEdi)).toMatchObject({
      state: 'teste', lastExercise: { id: DEMO.exerciseRestaurationEdi, recoveryMinutes: 270 },
    });
    expect(rows.find((r) => r.id === DEMO.continuityPaie)).toMatchObject({
      state: 'non_teste', lastExercise: null, assessedOn: '2025-09-15', biaDueOn: '2026-09-15',
    });
  });

  it('la vue de pilotage compte activités vitales, BIA à revoir et exercices planifiés', async () => {
    expect(await withTenant(app.db, T, (tx) => getContinuityOverview(tx, TODAY))).toEqual({
      activities: 4, vital: 1, criticalUntested: 0, objectiveMissed: 0, biaDue: 1, exercisesPlanned: 1,
    });
  });

  it('une activité s’enregistre avec ses dépendances ; la modifier les remplace ; la supprimer les emporte', async () => {
    const id = await withTenant(app.db, T, (tx) => createContinuityActivity(
      tx, { ...ACTIVITY, tenantId: T, createdBy: DEMO.userClaire },
      { assetIds: [DEMO.assetServeurs, DEMO.assetServeurs], supplierIds: [DEMO.supplierTransporteur] },
    ));
    let row = (await activities()).find((r) => r.id === id)!;
    expect(row.assets.map((a) => a.id)).toEqual([DEMO.assetServeurs]);
    expect(row.suppliers.map((s) => s.id)).toEqual([DEMO.supplierTransporteur]);

    expect(await withTenant(app.db, T, (tx) => updateContinuityActivity(
      tx, T, id, { ...ACTIVITY, criticality: 4, processId: DEMO.processPrepa }, { assetIds: [DEMO.assetWms], supplierIds: [] },
    ))).toBe(1);
    row = (await activities()).find((r) => r.id === id)!;
    expect(row).toMatchObject({ criticality: 4, processName: expect.any(String) });
    expect(row.assets.map((a) => a.id)).toEqual([DEMO.assetWms]);
    expect(row.suppliers).toEqual([]);

    expect(await withTenant(app.db, T, (tx) => deleteContinuityActivity(tx, id))).toEqual({ name: ACTIVITY.name });
    const [left] = await admin`
      SELECT (SELECT count(*) FROM continuity_activity_assets WHERE activity_id = ${id})::int
           + (SELECT count(*) FROM continuity_activity_suppliers WHERE activity_id = ${id})::int AS n`;
    expect((left as { n: number }).n).toBe(0);
  });

  it('la base refuse une criticité ou des objectifs hors bornes', async () => {
    const create = (over: Partial<ContinuityActivityInput>) => withTenant(app.db, T, (tx) => createContinuityActivity(
      tx, { ...ACTIVITY, ...over, tenantId: T, createdBy: DEMO.userClaire }, { assetIds: [], supplierIds: [] },
    ));
    await expectDbError(create({ criticality: 5 as ContinuityActivityInput['criticality'] }), /continuity_activities_criticality_check/);
    await expectDbError(create({ rtoHours: -1 }), /continuity_activities_rto_hours_check/);
    await expectDbError(create({ name: ' ' }), /continuity_activities_name_check/);
  });
});

describe('exercices et tests', () => {
  it('le seed porte un exercice planifié, une restauration réussie et un exercice sur table avec son action', async () => {
    const rows = await withTenant(app.db, T, (tx) => listContinuityExercises(tx));
    expect(rows.map((r) => r.id)).toEqual([DEMO.exerciseBasculeWms, DEMO.exerciseRestaurationEdi, DEMO.exerciseTableWms]);
    expect(rows[0]).toMatchObject({ status: 'planifie', result: null, leadName: 'Claire Morel', activities: [{ id: DEMO.continuityExpedition }] });
    expect(rows[1]).toMatchObject({ result: 'atteint', recoveryMinutes: 270, evidenceTitle: 'PV de test de restauration — T2 2026' });
    expect(rows[2]).toMatchObject({ result: 'partiel', actionCount: 1, openActionCount: 1 });
    const [origin] = await admin`SELECT origin_type::text AS t FROM actions WHERE id = ${DEMO.actionListesPapier}`;
    expect((origin as { t: string }).t).toBe('exercise');
  });

  it('une reprise mesurée au-delà de la DMIA fait passer l’activité en objectif manqué', async () => {
    const id = await withTenant(app.db, T, (tx) => createContinuityExercise(
      tx, { ...EXERCISE, recoveryMinutes: 25 * 60, tenantId: T, createdBy: DEMO.userClaire }, [DEMO.continuityEdi],
    ));
    expect((await activities()).find((r) => r.id === DEMO.continuityEdi)).toMatchObject({ state: 'objectif_manque' });
    expect(await withTenant(app.db, T, (tx) => updateContinuityExercise(tx, T, id, { ...EXERCISE, recoveryMinutes: 120 }, [DEMO.continuityEdi]))).toBe(1);
    expect((await activities()).find((r) => r.id === DEMO.continuityEdi)).toMatchObject({ state: 'teste', lastExercise: { id, recoveryMinutes: 120 } });
    expect(await withTenant(app.db, T, (tx) => deleteContinuityExercise(tx, id))).toEqual({ title: EXERCISE.title });
    expect((await activities()).find((r) => r.id === DEMO.continuityEdi)).toMatchObject({ lastExercise: { id: DEMO.exerciseRestaurationEdi } });
  });

  it('la base exige un résultat à l’exercice réalisé, et seulement à lui, et un objectif manqué documenté', async () => {
    const create = (over: Partial<ContinuityExerciseInput>) => withTenant(app.db, T, (tx) => createContinuityExercise(
      tx, { ...EXERCISE, ...over, tenantId: T, createdBy: DEMO.userClaire }, [],
    ));
    await expectDbError(create({ result: null }), /continuity_exercises_result/);
    await expectDbError(create({ status: 'planifie', recoveryMinutes: null }), /continuity_exercises_result/);
    await expectDbError(create({ status: 'planifie', result: null, recoveryMinutes: 30 }), /continuity_exercises_recovery/);
    await expectDbError(create({ result: 'non_atteint', findings: 'raté' }), /continuity_exercises_findings/);
    await expectDbError(create({ kind: 'pique-nique' as ContinuityExerciseInput['kind'] }), /continuity_exercises_kind_check/);
  });

  it('supprimer une activité la retire des exercices ; supprimer un processus détache l’activité', async () => {
    const [proc] = await admin`INSERT INTO processes (tenant_id, family, name) VALUES (${T}, 'support', 'Processus provisoire') RETURNING id`;
    const processId = (proc as { id: string }).id;
    const activityId = await withTenant(app.db, T, (tx) => createContinuityActivity(
      tx, { ...ACTIVITY, processId, tenantId: T, createdBy: DEMO.userClaire }, { assetIds: [], supplierIds: [] },
    ));
    const exerciseId = await withTenant(app.db, T, (tx) => createContinuityExercise(
      tx, { ...EXERCISE, tenantId: T, createdBy: DEMO.userClaire }, [activityId, DEMO.continuityPaie],
    ));
    await admin`DELETE FROM processes WHERE id = ${processId}`;
    expect((await activities()).find((r) => r.id === activityId)).toMatchObject({ processId: null });
    await withTenant(app.db, T, (tx) => deleteContinuityActivity(tx, activityId));
    const ex = (await withTenant(app.db, T, (tx) => listContinuityExercises(tx))).find((e) => e.id === exerciseId)!;
    expect(ex.activities.map((a) => a.id)).toEqual([DEMO.continuityPaie]);
    await withTenant(app.db, T, (tx) => deleteContinuityExercise(tx, exerciseId));
  });

  it('le module se masque comme les autres modules optionnels', async () => {
    await admin`UPDATE tenants SET disabled_modules = ARRAY['continuite']::text[] WHERE id = ${T}`;
    await admin`UPDATE tenants SET disabled_modules = '{}' WHERE id = ${T}`;
  });
});

describe('isolation entre organisations', () => {
  it('ni lecture, ni modification, ni dépendance, ni exercice d’une organisation à l’autre', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers continuité', 'tiers-continuite') RETURNING id`;
    const otherId = (other as { id: string }).id;
    expect(await activities(otherId)).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => listContinuityExercises(tx))).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => getContinuityOverview(tx, TODAY))).toMatchObject({ activities: 0, exercisesPlanned: 0 });
    expect(await withTenant(app.db, otherId, (tx) => updateContinuityActivity(
      tx, otherId, DEMO.continuityExpedition, ACTIVITY, { assetIds: [], supplierIds: [] },
    ))).toBe(0);
    expect(await withTenant(app.db, otherId, (tx) => deleteContinuityActivity(tx, DEMO.continuityExpedition))).toBeNull();
    expect(await withTenant(app.db, otherId, (tx) => updateContinuityExercise(tx, otherId, DEMO.exerciseTableWms, EXERCISE, []))).toBe(0);
    expect(await withTenant(app.db, otherId, (tx) => deleteContinuityExercise(tx, DEMO.exerciseTableWms))).toBeNull();

    const createOther = (input: Partial<ContinuityActivityInput>, deps: { assetIds: string[]; supplierIds: string[] }) =>
      withTenant(app.db, otherId, (tx) => createContinuityActivity(tx, { ...ACTIVITY, ...input, tenantId: otherId, createdBy: DEMO.userClaire }, deps));
    // Dépendances, processus et plan doivent appartenir à la même organisation.
    await expectDbError(createOther({}, { assetIds: [DEMO.assetWms], supplierIds: [] }), /foreign key/);
    await expectDbError(createOther({}, { assetIds: [], supplierIds: [DEMO.supplierHebergeur] }), /foreign key/);
    await expectDbError(createOther({ processId: DEMO.processPrepa }, { assetIds: [], supplierIds: [] }), /foreign key/);
    await expectDbError(createOther({ planDocumentId: DEMO.docProcSauvegarde }, { assetIds: [], supplierIds: [] }), /foreign key/);
    // Un exercice ne couvre que des activités de son organisation, ni ne cite la preuve d'une autre.
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createContinuityExercise(tx, { ...EXERCISE, tenantId: otherId, createdBy: DEMO.userClaire }, [DEMO.continuityEdi])),
      /foreign key/,
    );
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createContinuityExercise(
        tx, { ...EXERCISE, evidenceId: DEMO.evidenceRestauration, tenantId: otherId, createdBy: DEMO.userClaire }, [],
      )),
      /foreign key/,
    );
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createContinuityActivity(
        tx, { ...ACTIVITY, tenantId: T, createdBy: DEMO.userClaire }, { assetIds: [], supplierIds: [] },
      )),
      /row-level security/,
    );
    expect((await activities()).map((r) => r.id)).toContain(DEMO.continuityExpedition);
  });
});
