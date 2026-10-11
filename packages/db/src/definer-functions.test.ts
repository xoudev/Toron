import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from './migrate.ts';
import { PG_IMAGE } from './test-image.ts';

/**
 * Fonctions SECURITY DEFINER (migration 0040) : une table temporaire créée
 * par l'appelant ne doit jamais passer avant la vraie table, faute de quoi
 * un trigger de l'appelant s'exécuterait avec les droits du propriétaire.
 */

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let appSql: postgres.Sql;
let dbName: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  await applyMigrations(container.getConnectionUri());
  admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;
  dbName = container.getDatabase();
  // Une seule connexion : les objets temporaires vivent dans la session.
  appSql = postgres(
    `postgres://app_login:app_login_test@${container.getHost()}:${container.getMappedPort(5432)}/${dbName}`,
    { max: 1, onnotice: () => {} },
  );
});

afterAll(async () => {
  await appSql?.end();
  await admin?.end();
  await container?.stop();
});

describe('fonctions SECURITY DEFINER', () => {
  it('toutes fixent un search_path qui se termine par pg_temp', async () => {
    const rows = await admin<{ name: string; config: string[] | null }[]>`
      SELECT p.proname AS name, p.proconfig AS config
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
      ORDER BY p.proname`;
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const fautives = rows
      .filter((r) => {
        const setting = (r.config ?? []).find((c) => c.startsWith('search_path='));
        const last = setting?.slice('search_path='.length).split(',').pop()?.trim();
        return last !== 'pg_temp';
      })
      .map((r) => r.name);
    expect(fautives).toEqual([]);
  });

  it("aucun rôle runtime ne peut créer d'objet temporaire", async () => {
    for (const role of ['toron_app', 'toron_auth']) {
      const [row] = await admin<{ allowed: boolean }[]>`
        SELECT has_database_privilege(${role}, current_database(), 'TEMPORARY') AS allowed`;
      expect(row?.allowed).toBe(false);
    }
    await expect(appSql`CREATE TEMP TABLE essai (a int)`).rejects.toMatchObject({ code: '42501' });
  });

  it("une table temporaire homonyme n'intercepte pas claim_next_export", async () => {
    // Droit TEMPORARY rendu au seul login de test : on éprouve ici le
    // search_path indépendamment de la révocation.
    await admin.unsafe(`GRANT TEMPORARY ON DATABASE "${dbName}" TO app_login`);
    try {
      await appSql`CREATE TEMP TABLE exports (LIKE public.exports)`;
      await appSql.unsafe(`
        CREATE FUNCTION pg_temp.intercepte() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'intercepte'; END $$`);
      await appSql`
        CREATE TRIGGER intercepte BEFORE UPDATE ON pg_temp.exports
        FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.intercepte()`;

      await expect(appSql`SELECT * FROM claim_next_export()`).resolves.toHaveLength(0);

      // Témoin : avec l'ancien search_path, le trigger de l'appelant prenait
      // la main. Le test prouve donc bien quelque chose.
      await admin`ALTER FUNCTION claim_next_export() SET search_path = public`;
      try {
        await expect(appSql`SELECT * FROM claim_next_export()`).rejects.toThrow('intercepte');
      } finally {
        await admin`ALTER FUNCTION claim_next_export() SET search_path = pg_catalog, public, pg_temp`;
      }
    } finally {
      await appSql`DROP TABLE IF EXISTS pg_temp.exports`;
      await admin.unsafe(`REVOKE TEMPORARY ON DATABASE "${dbName}" FROM app_login`);
    }
  });
});
