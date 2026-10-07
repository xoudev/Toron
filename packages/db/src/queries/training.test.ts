import { createHash } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import {
  createTrainingSession,
  deleteTrainingSession,
  listLeaderTraining,
  listTrainingSessions,
  updateTrainingSession,
  type TrainingSessionInput,
} from './training.ts';

const T = DEMO.tenantId;
const TODAY = '2026-10-07';

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

const SESSION: TrainingSessionInput = {
  title: 'Sensibilisation des équipes de quai de Corbas', kind: 'sensibilisation', heldOn: '2026-09-15',
  durationMinutes: 45, audience: 'Équipes de quai, plateforme de Corbas', expectedCount: 30, attendedCount: 26,
  provider: 'RSSI interne', notes: null, evidenceId: null,
};

const create = (over: Partial<TrainingSessionInput> = {}, attendees: string[] = [], tenantId: string = T) =>
  withTenant(app.db, tenantId, (tx) => createTrainingSession(tx, { ...SESSION, ...over, tenantId, createdBy: DEMO.userClaire }, attendees));

const list = (tenantId: string = T) => withTenant(app.db, tenantId, (tx) => listTrainingSessions(tx, TODAY));

describe('sessions de sensibilisation', () => {
  it('le seed porte quatre sessions, dont une à venir, et nomme le seul dirigeant ayant un compte', async () => {
    const rows = await list();
    expect(rows.map((r) => r.id)).toEqual([DEMO.trainingRgpd, DEMO.trainingPhishing, DEMO.trainingPreparateurs, DEMO.trainingDirigeants]);
    expect(rows[0]).toMatchObject({ kind: 'rgpd', state: 'a_venir', expectedCount: 12, attendedCount: null, attendees: [] });
    expect(rows[2]).toMatchObject({ kind: 'sensibilisation', evidenceId: null });
    expect(rows[3]).toMatchObject({
      kind: 'formation_dirigeants', state: 'realisee', expectedCount: 4, attendedCount: 4,
      evidenceId: DEMO.evidenceFormationDirigeants, evidenceTitle: 'Attestations de formation des dirigeants — novembre 2025',
      attendees: [{ userId: DEMO.userAntoine, name: 'Antoine Vasseur' }],
    });
  });

  it('une session s’enregistre avec sa feuille d’émargement ; la modifier remplace ses présents', async () => {
    const id = await create({ evidenceId: DEMO.evidenceMfa }, [DEMO.userCamille, DEMO.userClaire, DEMO.userCamille]);
    const created = (await list()).find((r) => r.id === id)!;
    expect(created.attendees.map((a) => a.name)).toEqual(['Camille Poirier', 'Claire Morel']);
    expect(created.evidenceTitle).not.toBeNull();

    const n = await withTenant(app.db, T, (tx) => updateTrainingSession(tx, T, id, { ...SESSION, attendedCount: 27 }, [DEMO.userAntoine]));
    expect(n).toBe(1);
    expect((await list()).find((r) => r.id === id)).toMatchObject({
      attendedCount: 27, evidenceId: null, evidenceTitle: null, attendees: [{ userId: DEMO.userAntoine, name: 'Antoine Vasseur' }],
    });
    // Une présence se retire ou s'ajoute, elle ne se réécrit pas.
    await expectDbError(
      withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE training_attendees SET user_id = ${DEMO.userClaire} WHERE session_id = ${id}`)),
      /permission denied/,
    );
  });

  it('la base refuse une saisie hors bornes', async () => {
    await expectDbError(create({ title: ' x ' }), /training_sessions_title_check/);
    await expectDbError(create({ durationMinutes: 2 }), /training_sessions_duration_minutes_check/);
    await expectDbError(create({ attendedCount: -1 }), /training_sessions_attended_count_check/);
    await expectDbError(
      withTenant(app.db, T, (tx) => tx.execute(sql`
        INSERT INTO training_sessions (tenant_id, title, kind, held_on) VALUES (${T}, 'Atelier libre', 'webinaire', ${TODAY})`)),
      /training_sessions_kind_check/,
    );
  });

  it('supprimer la preuve détache la feuille ; supprimer la session emporte ses présences', async () => {
    const digest = createHash('sha256').update('feuille-emargement-corbas').digest('hex');
    const [ev] = await admin`
      INSERT INTO evidences (tenant_id, title, sha256, collected_at)
      VALUES (${T}, 'Feuille d’émargement — quai de Corbas', ${digest}, ${TODAY}) RETURNING id`;
    const evidenceId = (ev as { id: string }).id;
    const id = await create({ evidenceId }, [DEMO.userAntoine]);
    await withTenant(app.db, T, (tx) => tx.execute(sql`DELETE FROM evidences WHERE id = ${evidenceId}`));
    expect((await list()).find((r) => r.id === id)).toMatchObject({ evidenceId: null, attendees: [{ userId: DEMO.userAntoine }] });

    expect(await withTenant(app.db, T, (tx) => deleteTrainingSession(tx, id))).toEqual({ title: SESSION.title });
    const [left] = await admin`SELECT count(*)::int AS n FROM training_attendees WHERE session_id = ${id}`;
    expect((left as { n: number }).n).toBe(0);
    expect(await withTenant(app.db, T, (tx) => deleteTrainingSession(tx, id))).toBeNull();
  });

  it('le module se masque comme les autres modules optionnels', async () => {
    await admin`UPDATE tenants SET disabled_modules = ARRAY['sensibilisation']::text[] WHERE id = ${T}`;
    await admin`UPDATE tenants SET disabled_modules = '{}' WHERE id = ${T}`;
  });
});

describe('formation des dirigeants (NIS 2, art. 20)', () => {
  it('seuls les organes de direction sont suivis ; la formation d’Antoine est à renouveler d’ici au 18 novembre', async () => {
    const rows = await withTenant(app.db, T, (tx) => listLeaderTraining(tx, TODAY));
    expect(rows).toEqual([{
      userId: DEMO.userAntoine, name: 'Antoine Vasseur', role: 'direction',
      lastTrainedOn: '2025-11-18', dueOn: '2026-11-18', state: 'bientot',
    }]);
    expect((await withTenant(app.db, T, (tx) => listLeaderTraining(tx, '2026-06-01')))[0]).toMatchObject({ state: 'a_jour' });
    const later = await withTenant(app.db, T, (tx) => listLeaderTraining(tx, '2026-12-01'));
    expect(later[0]).toMatchObject({ state: 'a_renouveler' });
  });

  it('seule une session « dirigeants » déjà tenue renouvelle la formation', async () => {
    await create({ kind: 'sensibilisation', heldOn: '2026-09-30' }, [DEMO.userAntoine]);
    await create({ title: 'Formation des dirigeants, session de décembre', kind: 'formation_dirigeants', heldOn: '2026-12-10', attendedCount: null }, [DEMO.userAntoine]);
    let antoine = (await withTenant(app.db, T, (tx) => listLeaderTraining(tx, TODAY)))[0];
    expect(antoine).toMatchObject({ lastTrainedOn: '2025-11-18', state: 'bientot' });

    await create({ title: 'Formation des dirigeants, rappel d’octobre', kind: 'formation_dirigeants', heldOn: '2026-10-01', attendedCount: 3 }, [DEMO.userAntoine]);
    antoine = (await withTenant(app.db, T, (tx) => listLeaderTraining(tx, TODAY)))[0];
    expect(antoine).toMatchObject({ lastTrainedOn: '2026-10-01', dueOn: '2027-10-01', state: 'a_jour' });
  });

  it('un propriétaire jamais formé apparaît comme tel', async () => {
    const [u] = await admin`
      INSERT INTO users (email, name, email_verified)
      VALUES ('direction.generale@meridiane-logistics.example', 'Hélène Garnier', true) RETURNING id`;
    const userId = (u as { id: string }).id;
    await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${T}, ${userId}, 'owner')`;
    const rows = await withTenant(app.db, T, (tx) => listLeaderTraining(tx, TODAY));
    expect(rows.find((r) => r.userId === userId)).toEqual({
      userId, name: 'Hélène Garnier', role: 'owner', lastTrainedOn: null, dueOn: null, state: 'jamais',
    });
  });
});

describe('isolation entre organisations', () => {
  it('ni lecture, ni modification, ni preuve, ni présence d’une organisation à l’autre', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers formation', 'tiers-formation') RETURNING id`;
    const otherId = (other as { id: string }).id;
    expect(await list(otherId)).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => listLeaderTraining(tx, TODAY))).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => updateTrainingSession(tx, otherId, DEMO.trainingDirigeants, SESSION, []))).toBe(0);
    expect(await withTenant(app.db, otherId, (tx) => deleteTrainingSession(tx, DEMO.trainingDirigeants))).toBeNull();
    // La feuille d'émargement doit appartenir à la même organisation.
    await expectDbError(create({ evidenceId: DEMO.evidenceMfa }, [], otherId), /foreign key/);
    // Une présence ne se rattache pas à la session d'une autre organisation.
    await expectDbError(
      withTenant(app.db, otherId, (tx) => tx.execute(sql`
        INSERT INTO training_attendees (tenant_id, session_id, user_id)
        VALUES (${otherId}, ${DEMO.trainingDirigeants}, ${DEMO.userClaire})`)),
      /foreign key/,
    );
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createTrainingSession(tx, { ...SESSION, tenantId: T, createdBy: DEMO.userClaire }, [])),
      /row-level security/,
    );
    const demo = (await list()).find((r) => r.id === DEMO.trainingDirigeants)!;
    expect(demo).toMatchObject({ title: 'Formation des dirigeants à la cybersécurité (NIS 2, art. 20)', attendees: [{ userId: DEMO.userAntoine }] });
  });
});
