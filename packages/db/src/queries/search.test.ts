import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { parseSearchQuery, refCodeFor } from '@toron/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import { searchTenant } from './search.ts';

const T = DEMO.tenantId;
const OTHER = 'e0000000-0000-4000-8000-000000000002';

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
  await admin`CREATE ROLE search_app LOGIN PASSWORD 'search_app_test'`;
  await admin`GRANT toron_app TO search_app`;
  app = createDb(`postgres://search_app:search_app_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`);
  await admin`INSERT INTO tenants (id, name, slug) VALUES (${OTHER}, 'Concurrent', 'concurrent')`;
  await admin`INSERT INTO actions (tenant_id, title, origin_type) VALUES (${OTHER}, 'Revue confidentielle du concurrent', 'manual')`;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

const search = (tenant: string, q: string) => withTenant(app.db, tenant, (tx) => searchTenant(tx, parseSearchQuery(q)));

describe('recherche transverse', () => {
  it('trouve des éléments de plusieurs modules par leur intitulé', async () => {
    const hits = await search(T, 'revue');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.title)).not.toContain('Revue confidentielle du concurrent');
  });

  it('retrouve une action par son code lisible', async () => {
    const hits = await search(T, 'ACT-098');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.kind).toBe('action');
      expect(refCodeFor('action', h.id)).toBe('ACT-098');
    }
  });

  it('retrouve une exigence intégrée par son identifiant de clause', async () => {
    const hits = await search(T, 'A.5.19');
    const req = hits.find((h) => h.kind === 'exigence');
    expect(req?.title.startsWith('A.5.19')).toBe(true);
    expect(req?.parentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('n’interprète pas les jokers et ne déborde pas sur une autre organisation', async () => {
    expect(await search(T, '%%')).toEqual([]);
    expect(await search(T, '__')).toEqual([]);
    const other = await search(OTHER, 'confidentielle');
    expect(other.map((h) => h.title)).toEqual(['Revue confidentielle du concurrent']);
    expect(await search(T, 'confidentielle du concurrent')).toEqual([]);
  });

  it('trouve un intitulé à partir de mots épars, sans accents ni apostrophe typographique', async () => {
    const titles = async (q: string) => (await search(T, q)).map((h) => h.title);
    expect(await titles('pieces jointes messagerie')).toContain('Durcir la messagerie contre les pièces jointes piégées');
    expect(await titles("meyzieu l'entrepot")).toContain('Indisponibilité prolongée de l’entrepôt de Meyzieu');
    // Tous les termes sont requis.
    expect(await titles('messagerie meyzieu')).toEqual([]);
  });

  it('ne renvoie rien pour une saisie trop courte', async () => {
    expect(await search(T, 'a')).toEqual([]);
  });
});
