import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { nis2Qualification, suggestedObligations } from '@toron/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import {
  addCatalogObligations,
  createObligation,
  deleteObligation,
  listEntitiesNis2,
  listObligations,
  updateEntityNis2,
  updateObligation,
} from './obligations.ts';
import { listMyWork } from './work.ts';

const T = DEMO.tenantId;

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

const base = { entityId: null, regime: 'autre' as const, source: null, description: null, ownerUserId: null, justification: null, dueDate: null };

describe('qualification NIS 2 des entités (module 6.4)', () => {
  it('le seed qualifie Meridiane Logistics SAS en entité importante', async () => {
    const [entity] = await withTenant(app.db, T, (tx) => listEntitiesNis2(tx));
    expect(entity).toMatchObject({ sector: 'postal_expedition', employees: 148, turnoverMeur: 31.5, balanceSheetMeur: 18.2, registration: 'en_cours' });
    expect(nis2Qualification({ ...entity!, override: entity!.override }).status).toBe('ei');
  });

  it('une qualification retenue par l’organisation exige une justification', async () => {
    const input = {
      entityId: DEMO.entityId, sector: 'postal_expedition', employees: 148, turnoverMeur: 31.5, balanceSheetMeur: 18.2,
      override: 'ee' as const, overrideReason: null, registration: 'en_cours' as const, registeredOn: null, reference: null,
    };
    await expectDbError(withTenant(app.db, T, (tx) => updateEntityNis2(tx, input)), /legal_entities_override_justified/);
    const n = await withTenant(app.db, T, async (tx) => {
      const affected = await updateEntityNis2(tx, { ...input, overrideReason: 'Désignation notifiée par l’ANSSI' });
      await updateEntityNis2(tx, { ...input, override: null });
      return affected;
    });
    expect(n).toBe(1);
  });

  it('refuse un secteur inconnu', async () => {
    await expectDbError(withTenant(app.db, T, (tx) => updateEntityNis2(tx, {
      entityId: DEMO.entityId, sector: 'casino', employees: 10, turnoverMeur: null, balanceSheetMeur: null,
      override: null, overrideReason: null, registration: 'a_faire', registeredOn: null, reference: null,
    })), /check constraint/);
  });
});

describe('registre des obligations (module 6.4)', () => {
  it('le seed porte le catalogue complet d’une entité importante et une obligation contractuelle', async () => {
    const list = await withTenant(app.db, T, (tx) => listObligations(tx));
    expect(list.filter((o) => o.catalogKey !== null)).toHaveLength(suggestedObligations('ei').length);
    expect(list.some((o) => o.regime === 'contractuel')).toBe(true);
    expect(list[0]!.regime).toBe('nis2');
    const dpo = list.find((o) => o.catalogKey === 'rgpd_dpo')!;
    expect(dpo.status).toBe('non_applicable');
    expect(dpo.justification).toBeTruthy();
  });

  it('ajouter les suggestions deux fois ne crée pas de doublon', async () => {
    const added = await withTenant(app.db, T, (tx) => addCatalogObligations(tx, {
      tenantId: T, entityId: DEMO.entityId, ownerUserId: DEMO.userClaire, templates: suggestedObligations('ei'),
    }));
    expect(added).toBe(0);
  });

  it('écarter une obligation sans justification est refusé', async () => {
    await expectDbError(withTenant(app.db, T, (tx) => createObligation(tx, T, {
      ...base, title: 'Obligation sans motif', status: 'non_applicable',
    })), /obligations_justified/);
  });

  it('création, mise à jour puis suppression', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const id = await createObligation(tx, T, { ...base, title: 'Déclaration annuelle à l’assureur cyber', status: 'a_evaluer' });
      await updateObligation(tx, id, { ...base, title: 'Déclaration annuelle à l’assureur cyber', status: 'conforme' });
      const status = (await listObligations(tx)).find((o) => o.id === id)!.status;
      const removed = await deleteObligation(tx, id);
      return { status, removed };
    });
    expect(result).toEqual({ status: 'conforme', removed: { title: 'Déclaration annuelle à l’assureur cyber' } });
  });

  it('isolation : ni lecture croisée ni rattachement à l’entité d’une autre organisation', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers obligations', 'tiers-obligations') RETURNING id`;
    const otherId = (other as { id: string }).id;
    const seen = await withTenant(app.db, otherId, async (tx) => ({ obligations: await listObligations(tx), entities: await listEntitiesNis2(tx) }));
    expect(seen).toEqual({ obligations: [], entities: [] });
    await expectDbError(withTenant(app.db, otherId, (tx) => createObligation(tx, otherId, {
      ...base, entityId: DEMO.entityId, title: 'Rattachement interdit', status: 'a_evaluer',
    })), /foreign key/);
    const touched = await withTenant(app.db, otherId, (tx) => updateEntityNis2(tx, {
      entityId: DEMO.entityId, sector: 'hors_champ', employees: 1, turnoverMeur: null, balanceSheetMeur: null,
      override: null, overrideReason: null, registration: 'sans_objet', registeredOn: null, reference: null,
    }));
    expect(touched).toBe(0);
  });

  it('« Mon travail » liste les obligations ouvertes de leur responsable', async () => {
    const items = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userClaire));
    const mine = items.filter((i) => i.kind === 'obligation');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.find((i) => i.due === '2026-10-30')?.detail).toBe('Obligation en cours de mise en conformité');
    expect(mine.some((i) => i.title.startsWith('Notifier les incidents'))).toBe(false);
  });
});
