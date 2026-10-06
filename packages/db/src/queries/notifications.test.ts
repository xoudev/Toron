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
  countUnreadNotifications,
  currentOwner,
  listMyNotifications,
  markNotificationsRead,
  notifyAssignment,
} from './notifications.ts';

const T = DEMO.tenantId;
const SLUG = DEMO.slug;

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

const notice = {
  tenantId: T, slug: SLUG, actorUserId: DEMO.userClaire, subject: 'obligation' as const,
  objectId: DEMO.obligationContratClient, objectTitle: 'Remettre le compte rendu de restauration', previousOwnerId: DEMO.userClaire,
};

describe('notifications in-app (module 5.12)', () => {
  it('lit le responsable actuel d’un objet suivi', async () => {
    expect(await withTenant(app.db, T, (tx) => currentOwner(tx, 'obligation', DEMO.obligationContratClient))).toBe(DEMO.userClaire);
    expect(await withTenant(app.db, T, (tx) => currentOwner(tx, 'fournisseur', DEMO.supplierTransporteur))).toBe(DEMO.userAntoine);
  });

  it('prévient le nouveau responsable, seulement lui, avec un lien interne', async () => {
    const created = await withTenant(app.db, T, (tx) => notifyAssignment(tx, { ...notice, nextOwnerId: DEMO.userAntoine }));
    expect(created).toBe(true);
    const mine = await withTenant(app.db, T, (tx) => listMyNotifications(tx, DEMO.userAntoine));
    expect(mine[0]).toMatchObject({
      subject: 'obligation',
      title: 'Une obligation vous est confiée : Remettre le compte rendu de restauration',
      href: `/t/${SLUG}/obligations?ouvrir=${DEMO.obligationContratClient}`,
      actorName: 'Claire Morel',
      readAt: null,
    });
    expect(await withTenant(app.db, T, (tx) => listMyNotifications(tx, DEMO.userCamille))).toEqual([]);
  });

  it('ignore l’auto-attribution et un destinataire étranger à l’organisation', async () => {
    expect(await withTenant(app.db, T, (tx) => notifyAssignment(tx, { ...notice, previousOwnerId: null, nextOwnerId: DEMO.userClaire }))).toBe(false);
    const [stranger] = await admin`INSERT INTO users (email, name) VALUES ('externe@ailleurs.example', 'Externe') RETURNING id`;
    expect(await withTenant(app.db, T, (tx) => notifyAssignment(tx, { ...notice, nextOwnerId: (stranger as { id: string }).id }))).toBe(false);
  });

  it('compte et marque comme lues les notifications du seul destinataire', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const before = await countUnreadNotifications(tx, DEMO.userAntoine);
      const othersMarked = await markNotificationsRead(tx, DEMO.userCamille);
      const marked = await markNotificationsRead(tx, DEMO.userAntoine);
      return { before, othersMarked, marked, after: await countUnreadNotifications(tx, DEMO.userAntoine) };
    });
    expect(result).toEqual({ before: 1, othersMarked: 0, marked: 1, after: 0 });
  });

  it('refuse un lien externe et toute modification autre que la lecture', async () => {
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`
      INSERT INTO notifications (tenant_id, user_id, kind, subject, title, href)
      VALUES (${T}, ${DEMO.userAntoine}, 'assignation', 'action', 'Piège', 'https://exemple.org/t/x')
    `)), /check constraint/);
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE notifications SET title = 'modifié'`)), /permission denied/);
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`DELETE FROM notifications`)), /permission denied/);
  });

  it('isolation : une autre organisation ne voit ni ne crée de notification ici', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers notifications', 'tiers-notifications') RETURNING id`;
    const otherId = (other as { id: string }).id;
    expect(await withTenant(app.db, otherId, (tx) => listMyNotifications(tx, DEMO.userAntoine))).toEqual([]);
    expect(await withTenant(app.db, otherId, (tx) => notifyAssignment(tx, { ...notice, tenantId: T, nextOwnerId: DEMO.userAntoine }))).toBe(false);
  });

  it('les notifications d’un membre retiré disparaissent avec son adhésion', async () => {
    await withTenant(app.db, T, (tx) => notifyAssignment(tx, { ...notice, previousOwnerId: null, nextOwnerId: DEMO.userCamille }));
    await admin`DELETE FROM memberships WHERE tenant_id = ${T} AND user_id = ${DEMO.userCamille}`;
    const [{ n }] = (await admin`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${DEMO.userCamille}`) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});
