import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  addComment,
  addSubtask,
  bulkSetStatus,
  createAction,
  getActionDetail,
  listActions,
  setActionStatus,
  setSubtaskDone,
} from './actions.ts';

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

const YESTERDAY = '2020-01-01';
const FUTURE = '2999-12-31';

describe('création & liaisons', () => {
  it('crée une action pré-liée à une exigence (RM §5.5) et l’expose', async () => {
    const detail = await withTenant(app.db, T, async (tx) => {
      const reqRows = (await tx.execute(
        sql`SELECT id FROM requirements WHERE ref_id = 'A.8.5' LIMIT 1`,
      )) as unknown as { id: string }[];
      const req = reqRows[0];
      const id = await createAction(tx, {
        tenantId: T,
        title: 'Test — MFA prestataires',
        originType: 'assessment',
        originId: null,
        links: [{ targetType: 'requirement', targetId: req!.id }],
      });
      return getActionDetail(tx, id);
    });
    expect(detail.links).toHaveLength(1);
    expect(detail.links[0]!.label).toBe('A.8.5');
  });
});

describe('retard calculé (RM §5.5)', () => {
  it('une échéance passée sur une action non terminée ⇒ statut effectif « en_retard »', async () => {
    const eff = await withTenant(app.db, T, async (tx) => {
      const id = await createAction(tx, {
        tenantId: T,
        title: 'Test — en retard',
        originType: 'manual',
        dueDate: YESTERDAY,
      });
      return (await listActions(tx)).find((a) => a.id === id)!.effectiveStatus;
    });
    expect(eff).toBe('en_retard');
  });

  it('une action terminée à échéance passée n’est pas « en_retard »', async () => {
    const eff = await withTenant(app.db, T, async (tx) => {
      const id = await createAction(tx, {
        tenantId: T,
        title: 'Test — terminée passée',
        originType: 'manual',
        dueDate: YESTERDAY,
      });
      await setActionStatus(tx, id, 'termine');
      return (await listActions(tx)).find((a) => a.id === id)!.effectiveStatus;
    });
    expect(eff).toBe('termine');
  });

  it('le seed démo comporte une action en retard (revue des accès)', async () => {
    const eff = await withTenant(app.db, T, async (tx) =>
      (await listActions(tx)).find((a) => a.id === DEMO.actionRevueAcces)?.effectiveStatus,
    );
    expect(eff).toBe('en_retard');
  });
});

describe('sous-tâches, commentaires, actions groupées', () => {
  it('suit l’avancement des sous-tâches et le fil de commentaires', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const id = await createAction(tx, {
        tenantId: T,
        title: 'Test — sous-tâches',
        originType: 'manual',
        dueDate: FUTURE,
      });
      const s1 = await addSubtask(tx, { tenantId: T, actionId: id, title: 'Étape 1' });
      await addSubtask(tx, { tenantId: T, actionId: id, title: 'Étape 2' });
      await setSubtaskDone(tx, s1, true);
      await addComment(tx, { tenantId: T, actionId: id, authorUserId: DEMO.userClaire, body: 'Lancé.' });
      const summary = (await listActions(tx)).find((a) => a.id === id)!;
      const detail = await getActionDetail(tx, id);
      return { summary, detail };
    });
    expect(res.summary.subtaskTotal).toBe(2);
    expect(res.summary.subtaskDone).toBe(1);
    expect(res.summary.commentCount).toBe(1);
    expect(res.detail.comments[0]!.authorName).toBe('Claire Morel');
  });

  it('bulkSetStatus change plusieurs actions à la fois', async () => {
    const changed = await withTenant(app.db, T, async (tx) => {
      const a = await createAction(tx, { tenantId: T, title: 'Groupe A', originType: 'manual' });
      const b = await createAction(tx, { tenantId: T, title: 'Groupe B', originType: 'manual' });
      const n = await bulkSetStatus(tx, [a, b], 'en_cours');
      const list = await listActions(tx, { status: 'en_cours' });
      const bothEnCours = [a, b].every((id) => list.some((x) => x.id === id));
      return { n, bothEnCours };
    });
    expect(changed.n).toBe(2);
    expect(changed.bothEnCours).toBe(true);
  });
});

describe('isolation', () => {
  it('les actions d’un tenant sont invisibles d’un autre (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) =>
      createAction(tx, { tenantId: T, title: 'Action isolée', originType: 'manual' }),
    );
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers action', 'tiers-action') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listActions(tx));
    expect(seen.some((a) => a.id === id)).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('le fil de commentaires est append-only pour le rôle applicatif', async () => {
    let rejected = false;
    try {
      await withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE action_comments SET body = 'x'`));
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
