import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeAuditEntry } from './audit.ts';
import { createDb, type DbHandle } from './client.ts';
import { applyMigrations } from './migrate.ts';
import { getAuditChainHead, verifyAuditChain } from './queries/audit.ts';
import { auditLog } from './schema/index.ts';
import { withTenant } from './tenant.ts';
import { PG_IMAGE } from './test-image.ts';

/**
 * Chaînage du journal d'audit (migration 0037) : chaque entrée porte son
 * numéro d'ordre et une empreinte qui couvre la précédente ; toute
 * altération, même faite avec des droits directs sur la base, se voit.
 */

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let authSql: postgres.Sql;
let app: DbHandle;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  const uri = container.getConnectionUri();
  await applyMigrations(uri);
  admin = postgres(uri, { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;
  await admin`CREATE ROLE auth_login LOGIN PASSWORD 'auth_login_test'`;
  await admin`GRANT toron_auth TO auth_login`;
  const base = `${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
  app = createDb(`postgres://app_login:app_login_test@${base}`);
  authSql = postgres(`postgres://auth_login:auth_login_test@${base}`, { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await app?.close();
  await authSql?.end();
  await admin?.end();
  await container?.stop();
});

async function newTenant(slug: string): Promise<string> {
  const [t] = await admin`INSERT INTO tenants (name, slug) VALUES (${slug}, ${slug}) RETURNING id`;
  return (t as { id: string }).id;
}

const write = (tenantId: string, action: string, after: Record<string, unknown> = {}) =>
  withTenant(app.db, tenantId, (tx) => writeAuditEntry(tx, { tenantId, action, objectType: 'test', after }));

const verify = (tenantId: string) => withTenant(app.db, tenantId, (tx) => verifyAuditChain(tx));

/** Altération hors application : le trigger d'immuabilité est suspendu, comme le ferait un administrateur malveillant. */
async function tamper(statement: (sql: postgres.Sql) => Promise<unknown>): Promise<void> {
  await admin`ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable_row`;
  try {
    await statement(admin);
  } finally {
    await admin`ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable_row`;
  }
}

describe('chaînage à l’insertion', () => {
  it('numérote les entrées d’une organisation et les chaîne, la première sur 64 zéros', async () => {
    const t = await newTenant('chaine-a');
    for (const action of ['risk.create', 'risk.update', 'export.seal']) await write(t, action, { n: action });
    const rows = await admin`SELECT seq, prev_hash, hash FROM audit_log WHERE tenant_id = ${t} ORDER BY seq` as unknown as
      { seq: string; prev_hash: string; hash: string }[];
    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3]);
    expect(rows[0]!.prev_hash).toBe('0'.repeat(64));
    expect(rows[1]!.prev_hash).toBe(rows[0]!.hash);
    expect(rows[2]!.prev_hash).toBe(rows[1]!.hash);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash))).toBe(true);
    expect(await verify(t)).toMatchObject({ entries: 3, lastSeq: 3, headSeq: 3, intact: true, brokenAtSeq: null });
  });

  it('ignore le numéro et l’empreinte fournis par l’appelant', async () => {
    const t = await newTenant('chaine-forge');
    await withTenant(app.db, t, (tx) => tx.insert(auditLog).values({
      tenantId: t, action: 'test.forge', objectType: 'test', seq: 999, prevHash: 'a'.repeat(64), hash: 'b'.repeat(64),
    }));
    const [row] = await admin`SELECT seq, prev_hash, hash FROM audit_log WHERE tenant_id = ${t}` as unknown as
      { seq: string; prev_hash: string; hash: string }[];
    expect(Number(row!.seq)).toBe(1);
    expect(row!.prev_hash).toBe('0'.repeat(64));
    expect(row!.hash).not.toBe('b'.repeat(64));
    expect((await verify(t)).intact).toBe(true);
  });

  it('des insertions concurrentes restent une chaîne continue', async () => {
    const t = await newTenant('chaine-concurrence');
    await Promise.all(Array.from({ length: 12 }, (_, i) => write(t, `parallel.${i}`, { i })));
    const seqs = (await admin`SELECT seq FROM audit_log WHERE tenant_id = ${t} ORDER BY seq` as unknown as { seq: string }[]).map((r) => Number(r.seq));
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(await verify(t)).toMatchObject({ entries: 12, intact: true });
  });

  it('les entrées écrites par la couche d’authentification se chaînent aussi', async () => {
    const t = await newTenant('chaine-auth');
    await authSql`INSERT INTO audit_log (tenant_id, action, object_type) VALUES (${t}, 'session.tenant_enter', 'tenant')`;
    await write(t, 'risk.create');
    expect(await verify(t)).toMatchObject({ entries: 2, lastSeq: 2, intact: true });
  });

  it('chaque organisation a sa propre chaîne', async () => {
    const a = await newTenant('chaine-iso-a');
    const b = await newTenant('chaine-iso-b');
    await write(a, 'a.1');
    await write(b, 'b.1');
    await write(a, 'a.2');
    expect(await verify(a)).toMatchObject({ entries: 2, lastSeq: 2, intact: true });
    expect(await verify(b)).toMatchObject({ entries: 1, lastSeq: 1, intact: true });
  });
});

describe('altérations détectées', () => {
  it('une entrée modifiée casse la chaîne à partir d’elle', async () => {
    const t = await newTenant('chaine-modif');
    for (let i = 1; i <= 4; i += 1) await write(t, 'risk.update', { i });
    await tamper((db) => db`UPDATE audit_log SET after = '{"i": 99}'::jsonb WHERE tenant_id = ${t} AND seq = 2`);
    expect(await verify(t)).toMatchObject({ intact: false, brokenAtSeq: 2 });
  });

  it('une entrée supprimée au milieu se voit', async () => {
    const t = await newTenant('chaine-trou');
    for (let i = 1; i <= 4; i += 1) await write(t, 'risk.update', { i });
    await tamper((db) => db`DELETE FROM audit_log WHERE tenant_id = ${t} AND seq = 3`);
    expect(await verify(t)).toMatchObject({ intact: false, brokenAtSeq: 4 });
  });

  it('les dernières entrées effacées se voient grâce à la tête de chaîne', async () => {
    const t = await newTenant('chaine-queue');
    for (let i = 1; i <= 5; i += 1) await write(t, 'risk.update', { i });
    await tamper((db) => db`DELETE FROM audit_log WHERE tenant_id = ${t} AND seq >= 4`);
    expect(await verify(t)).toMatchObject({ intact: false, entries: 3, lastSeq: 3, headSeq: 5, brokenAtSeq: 4 });
  });

  it('une entrée falsifiée dont l’empreinte est recalculée se voit à l’entrée suivante', async () => {
    const t = await newTenant('chaine-recalcul');
    for (let i = 1; i <= 3; i += 1) await write(t, 'risk.update', { i });
    await tamper((db) => db`
      UPDATE audit_log
         SET after = '{"i": 42}'::jsonb,
             hash = audit_log_entry_hash(prev_hash, seq, tenant_id, at, actor_user_id, action, object_type, object_id,
                                         before, '{"i": 42}'::jsonb, ip, user_agent)
       WHERE tenant_id = ${t} AND seq = 2`);
    expect(await verify(t)).toMatchObject({ intact: false, brokenAtSeq: 3 });
  });
});

describe('tête de chaîne hors de portée de l’application', () => {
  it('ni lecture ni écriture directe pour les rôles applicatifs', async () => {
    const t = await newTenant('chaine-tete');
    await write(t, 'risk.create');
    await expect(withTenant(app.db, t, (tx) => tx.execute(sql`SELECT * FROM audit_chain_heads`))).rejects.toThrow();
    await expect(withTenant(app.db, t, (tx) => tx.execute(sql`UPDATE audit_chain_heads SET seq = 0`))).rejects.toThrow();
    await expect(authSql`SELECT * FROM audit_chain_heads`).rejects.toThrow(/permission denied/);
    const head = await withTenant(app.db, t, (tx) => getAuditChainHead(tx));
    expect(head?.seq).toBe(1);
    expect(head?.hash).toMatch(/^[0-9a-f]{64}$/);
    // La tête d'une autre organisation n'est pas lisible : la fonction ne suit que le contexte courant.
    const other = await newTenant('chaine-tete-vide');
    expect(await withTenant(app.db, other, (tx) => getAuditChainHead(tx))).toBeNull();
  });
});
