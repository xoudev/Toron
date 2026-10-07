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
  createControlReview,
  getControlDetail,
  listControlLibrary,
  listControlReviews,
  updateControl,
} from './control-reviews.ts';
import { listMyWork } from './work.ts';

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

const review = (over: Partial<Parameters<typeof createControlReview>[1]> = {}) =>
  withTenant(app.db, T, (tx) => createControlReview(tx, {
    tenantId: T, controlId: DEMO.controlInventaire, reviewedOn: TODAY, reviewerUserId: DEMO.userCamille,
    method: 'revue_documentaire', result: 'efficace', observations: null, evidenceId: null, ...over,
  }));

describe('bibliothèque des contrôles', () => {
  it('le seed porte une MFA en retard de revue, des sauvegardes défaillantes et un inventaire jamais revu', async () => {
    const rows = await withTenant(app.db, T, (tx) => listControlLibrary(tx, TODAY));
    const byId = (id: string) => rows.find((r) => r.id === id)!;
    expect(byId(DEMO.controlMfa)).toMatchObject({
      frequency: 'semestrielle', lastReviewedOn: '2026-04-02', lastResult: 'partiellement_efficace',
      nextReviewOn: '2026-10-02', reviewState: 'en_retard', mutualized: true, openExceptionCount: 1,
    });
    expect(byId(DEMO.controlSauvegardes)).toMatchObject({
      lastResult: 'inefficace', reviewCount: 2, nextReviewOn: '2026-10-10', reviewState: 'bientot',
    });
    expect(byId(DEMO.controlInventaire)).toMatchObject({
      lastReviewedOn: null, reviewCount: 0, nextReviewOn: '2026-09-01', reviewState: 'en_retard',
    });
  });

  it('le détail rassemble exigences couvertes, risques, dérogations et revues', async () => {
    const d = (await withTenant(app.db, T, (tx) => getControlDetail(tx, DEMO.controlMfa)))!;
    expect(d.requirements.map((r) => r.ref)).toEqual(expect.arrayContaining(['A.8.5', 'OBJ-08']));
    expect(d.exceptions.map((e) => e.id)).toContain(DEMO.exceptionTelemaintenance);
    expect(d.reviews[0]).toMatchObject({ reviewedOn: '2026-04-02', reviewerName: 'Claire Morel', method: 'echantillonnage' });
    expect(await withTenant(app.db, T, (tx) => getControlDetail(tx, '00000000-0000-4000-8000-000000000000'))).toBeNull();
  });
});

describe('revues d’efficacité', () => {
  it('une revue consignée devient la dernière et repousse l’échéance', async () => {
    await review({ result: 'efficace', reviewedOn: '2026-10-05' });
    const rows = await withTenant(app.db, T, (tx) => listControlLibrary(tx, TODAY));
    expect(rows.find((r) => r.id === DEMO.controlInventaire)).toMatchObject({
      lastReviewedOn: '2026-10-05', lastResult: 'efficace', nextReviewOn: '2027-10-05', reviewState: 'a_jour',
    });
  });

  it('un contrôle défaillant se documente', async () => {
    await expectDbError(review({ result: 'inefficace', observations: 'ko' }), /control_reviews_findings/);
    expect(await review({ result: 'inefficace', observations: 'Inventaire de Vitrolles absent de la liste consolidée.' })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('l’historique ne se modifie ni ne se supprime', async () => {
    const id = await review();
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE control_reviews SET result = 'inefficace' WHERE id = ${id}`)), /permission denied/);
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`DELETE FROM control_reviews WHERE id = ${id}`)), /permission denied/);
  });

  it('supprimer un contrôle emporte ses revues', async () => {
    const [ctl] = await admin`INSERT INTO controls (tenant_id, title) VALUES (${T}, 'Contrôle provisoire') RETURNING id`;
    const controlId = (ctl as { id: string }).id;
    await review({ controlId });
    await withTenant(app.db, T, (tx) => tx.execute(sql`DELETE FROM controls WHERE id = ${controlId}`));
    expect(await withTenant(app.db, T, (tx) => listControlReviews(tx, controlId))).toEqual([]);
  });

  it('la fiche se met à jour : fréquence, responsable, statut', async () => {
    const n = await withTenant(app.db, T, (tx) => updateControl(tx, {
      controlId: DEMO.controlInventaire, title: 'Inventaire des activités, services et SI supports',
      description: null, ownerUserId: DEMO.userCamille, reviewFrequency: 'semestrielle', status: 'actif',
    }));
    expect(n).toBe(1);
    const row = (await withTenant(app.db, T, (tx) => listControlLibrary(tx, TODAY))).find((r) => r.id === DEMO.controlInventaire)!;
    expect(row).toMatchObject({ frequency: 'semestrielle', ownerName: 'Camille Poirier' });
  });
});

describe('« Mon travail »', () => {
  it('le responsable voit l’échéance de sa prochaine revue', async () => {
    const items = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userClaire));
    expect(items.find((i) => i.id === DEMO.controlMfa)).toMatchObject({ kind: 'controle', due: '2026-10-02', detail: 'Revue d’efficacité à réaliser' });
    const antoine = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userAntoine));
    expect(antoine.find((i) => i.id === DEMO.controlSauvegardes)).toMatchObject({ due: '2026-10-10' });
  });
});

describe('isolation entre organisations', () => {
  it('ni lecture, ni revue, ni preuve, ni mise à jour d’une organisation à l’autre', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers contrôles', 'tiers-controles') RETURNING id`;
    const otherId = (other as { id: string }).id;
    expect(await withTenant(app.db, otherId, (tx) => listControlLibrary(tx, TODAY))).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => listControlReviews(tx, DEMO.controlMfa))).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => getControlDetail(tx, DEMO.controlMfa))).toBeNull();
    // Un contrôle d'ailleurs ne reçoit pas de revue, même en forgeant son identifiant.
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createControlReview(tx, {
        tenantId: otherId, controlId: DEMO.controlMfa, reviewedOn: TODAY, reviewerUserId: DEMO.userClaire,
        method: 'entretien', result: 'efficace', observations: null, evidenceId: null,
      })),
      /foreign key/,
    );
    const [ctl] = await admin`INSERT INTO controls (tenant_id, title) VALUES (${otherId}, 'Contrôle tiers') RETURNING id`;
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createControlReview(tx, {
        tenantId: otherId, controlId: (ctl as { id: string }).id, reviewedOn: TODAY, reviewerUserId: DEMO.userClaire,
        method: 'entretien', result: 'efficace', observations: null, evidenceId: DEMO.evidenceMfa,
      })),
      /foreign key/,
    );
    expect(await withTenant(app.db, otherId, (tx) => updateControl(tx, {
      controlId: DEMO.controlMfa, title: 'Détourné', description: null, ownerUserId: null, reviewFrequency: null, status: 'archive',
    }))).toBe(0);
    await expectDbError(
      withTenant(app.db, otherId, (tx) => createControlReview(tx, {
        tenantId: T, controlId: DEMO.controlMfa, reviewedOn: TODAY, reviewerUserId: DEMO.userClaire,
        method: 'entretien', result: 'efficace', observations: null, evidenceId: null,
      })),
      /row-level security/,
    );
  });
});
