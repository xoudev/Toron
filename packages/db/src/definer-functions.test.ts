import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from './migrate.ts';
import { PG_IMAGE } from './test-image.ts';

/**
 * Fonctions SECURITY DEFINER (migration 0040) : un objet temporaire créé par
 * l'appelant ne doit jamais passer avant le vrai, faute de quoi un trigger
 * de l'appelant s'exécuterait avec les droits du propriétaire.
 *
 * Les fonctions en lecture seule (verify_export, audit_chain_head,
 * supplier_portal_lookup) ne déclenchent aucun trigger : la configuration
 * vérifiée ci-dessous suffit à les couvrir. Les attaques sont rejouées sur
 * les deux fonctions qui écrivent.
 */

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let appSql: postgres.Sql;
let dbName: string;
let tenantId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  await applyMigrations(container.getConnectionUri());
  admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;
  const [t] = await admin<{ id: string }[]>`
    INSERT INTO tenants (name, slug) VALUES ('Meridiane Logistics', 'meridiane-logistics') RETURNING id`;
  tenantId = t!.id;
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

/** Rend le droit TEMPORARY au seul login de test : on éprouve le search_path indépendamment de la révocation. */
async function withTemporary(fn: () => Promise<void>): Promise<void> {
  await admin.unsafe(`GRANT TEMPORARY ON DATABASE "${dbName}" TO app_login`);
  try {
    await fn();
  } finally {
    await admin.unsafe(`REVOKE TEMPORARY ON DATABASE "${dbName}" FROM app_login`);
  }
}

describe('fonctions SECURITY DEFINER', () => {
  it('toutes fixent search_path = pg_catalog, public, pg_temp et sont fermées à PUBLIC', async () => {
    const rows = await admin<{ name: string; config: string[] | null; publicExecute: boolean }[]>`
      SELECT n.nspname || '.' || p.proname AS name, p.proconfig AS config,
             has_function_privilege('public', p.oid, 'EXECUTE') AS "publicExecute"
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 1`;
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const fautives = rows
      .filter((r) => !(r.config ?? []).includes('search_path=pg_catalog, public, pg_temp') || r.publicExecute)
      .map((r) => r.name);
    expect(fautives).toEqual([]);
  });

  it('aucun rôle runtime ne peut créer de schéma, ni d’objet temporaire ou dans public', async () => {
    await expect(admin`SELECT * FROM runtime_privilege_leaks()`).resolves.toHaveLength(0);
    await expect(appSql`CREATE TEMP TABLE essai (a int)`).rejects.toMatchObject({ code: '42501' });
    await expect(appSql`CREATE TABLE public.essai (a int)`).rejects.toMatchObject({ code: '42501' });
    await expect(appSql`CREATE SCHEMA essai`).rejects.toMatchObject({ code: '42501' });
  });

  it('un droit rendu par erreur est signalé, et bloque le passage suivant des migrations', async () => {
    await withTemporary(async () => {
      await expect(admin`SELECT role_name, privilege FROM runtime_privilege_leaks()`).resolves.toEqual([
        { role_name: 'app_login', privilege: 'TEMPORARY' },
      ]);
      await expect(applyMigrations(container.getConnectionUri())).rejects.toThrow(/app_login \(TEMPORARY\)/);
    });
    await expect(applyMigrations(container.getConnectionUri())).resolves.toEqual([]);
  });

  it("une table temporaire homonyme n'intercepte pas claim_next_export", async () => {
    await withTemporary(async () => {
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
      }
    });
  });

  it("une tête de chaîne temporaire n'intercepte pas l'insertion dans le journal d'audit", async () => {
    const insertAudit = () =>
      appSql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        await tx`INSERT INTO audit_log (tenant_id, action, object_type) VALUES (${tenantId}, 'essai', 'test')`;
      });
    await withTemporary(async () => {
      try {
        await appSql`
          CREATE TEMP TABLE audit_chain_heads (
            tenant_id uuid PRIMARY KEY, seq bigint NOT NULL, hash text NOT NULL, updated_at timestamptz DEFAULT now())`;
        await appSql.unsafe(`
          CREATE FUNCTION pg_temp.intercepte_chaine() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'intercepte'; END $$`);
        await appSql`
          CREATE TRIGGER intercepte BEFORE INSERT ON pg_temp.audit_chain_heads
          FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.intercepte_chaine()`;

        await expect(insertAudit()).resolves.toBeUndefined();
        const [head] = await admin<{ seq: string }[]>`SELECT seq FROM audit_chain_heads WHERE tenant_id = ${tenantId}`;
        expect(Number(head?.seq)).toBe(1);

        await admin`ALTER FUNCTION audit_log_chain() SET search_path = pg_catalog, public`;
        try {
          await expect(insertAudit()).rejects.toThrow('intercepte');
        } finally {
          await admin`ALTER FUNCTION audit_log_chain() SET search_path = pg_catalog, public, pg_temp`;
        }
      } finally {
        await appSql`DROP TABLE IF EXISTS pg_temp.audit_chain_heads`;
      }
    });
  });
});
