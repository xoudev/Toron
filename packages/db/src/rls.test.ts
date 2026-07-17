import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from './client.js';
import { applyMigrations } from './migrate.js';
import * as schema from './schema/index.js';
import { withTenant } from './tenant.js';

/**
 * Tests d'isolation cross-tenant (S1, ADR-3) — gate de merge.
 * Exécutés contre un vrai PostgreSQL 16 (testcontainers), avec le rôle
 * applicatif réel (membre de toron_app, sans BYPASSRLS) : aucune
 * simulation, la DoD M0 exige la preuve.
 */

const PG_IMAGE = 'postgres:16.14-alpine3.23';

/**
 * Drizzle enveloppe les erreurs Postgres (DrizzleQueryError « Failed
 * query… ») ; le message d'origine vit dans la chaîne `cause`. On
 * vérifie donc le motif sur la chaîne complète — et on échoue si la
 * requête passe.
 */
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
  expect.fail('La requête aurait dû être rejetée par Postgres, elle a réussi.');
}

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql; // superuser : migrations + seed hors RLS
let app: DbHandle; // rôle applicatif soumis à la RLS

// Identifiants posés par le seed
let tenantA: string;
let tenantB: string;
let aliceId: string; // membre de A uniquement
let bobId: string; // membre de B uniquement
let builtinFrameworkId: string;
let builtinReqId: string;
let controlAId: string;
let controlBId: string;
let scopeAId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  const adminUri = container.getConnectionUri();

  await applyMigrations(adminUri);

  admin = postgres(adminUri, { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;

  // ── Seed système (superuser — la création de tenants/users/memberships
  //    est une opération de la couche auth, hors rôle applicatif) ──
  const [ta] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tenant A', 'tenant-a') RETURNING id`;
  const [tb] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tenant B', 'tenant-b') RETURNING id`;
  tenantA = (ta as { id: string }).id;
  tenantB = (tb as { id: string }).id;

  const [alice] = await admin`INSERT INTO users (email) VALUES ('alice@tenant-a.example') RETURNING id`;
  const [bob] = await admin`INSERT INTO users (email) VALUES ('bob@tenant-b.example') RETURNING id`;
  aliceId = (alice as { id: string }).id;
  bobId = (bob as { id: string }).id;

  await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantA}, ${aliceId}, 'rssi')`;
  await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantB}, ${bobId}, 'rssi')`;

  // Référentiel builtin partagé (ex. ReCyF) + une exigence
  const [fw] = await admin`
    INSERT INTO frameworks (tenant_id, code, version, name, source)
    VALUES (NULL, 'recyf', 'v2.5', 'NIS 2 · ReCyF', 'builtin') RETURNING id`;
  builtinFrameworkId = (fw as { id: string }).id;
  const [req] = await admin`
    INSERT INTO requirements (tenant_id, framework_id, ref_id, title_internal)
    VALUES (NULL, ${builtinFrameworkId}, 'OBJ-08', 'Authentification renforcée des accès distants')
    RETURNING id`;
  builtinReqId = (req as { id: string }).id;

  // ── Seed métier via le chemin applicatif réel (withTenant) ──
  const appUri = `postgres://app_login:app_login_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
  app = createDb(appUri);

  await withTenant(app.db, tenantA, async (tx) => {
    const [scope] = await tx
      .insert(schema.scopes)
      .values({ tenantId: tenantA, name: 'SMSI Groupe', kind: 'smsi' })
      .returning();
    scopeAId = scope!.id;
    const [control] = await tx
      .insert(schema.controls)
      .values({ tenantId: tenantA, title: 'Revue trimestrielle des accès fournisseurs' })
      .returning();
    controlAId = control!.id;
  });

  await withTenant(app.db, tenantB, async (tx) => {
    await tx.insert(schema.scopes).values({ tenantId: tenantB, name: 'SMSI B', kind: 'smsi' });
    const [control] = await tx
      .insert(schema.controls)
      .values({ tenantId: tenantB, title: 'MFA sur les accès VPN' })
      .returning();
    controlBId = control!.id;
  });
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

describe('isolation en lecture', () => {
  it('le tenant A ne voit que ses propres contrôles et périmètres', async () => {
    const { controlTitles, scopeNames } = await withTenant(app.db, tenantA, async (tx) => ({
      controlTitles: (await tx.select().from(schema.controls)).map((c) => c.title),
      scopeNames: (await tx.select().from(schema.scopes)).map((s) => s.name),
    }));
    expect(controlTitles).toEqual(['Revue trimestrielle des accès fournisseurs']);
    expect(scopeNames).toEqual(['SMSI Groupe']);
  });

  it("un ID forgé d'un autre tenant ne retourne aucune ligne", async () => {
    const rows = await withTenant(app.db, tenantA, (tx) =>
      tx.select().from(schema.controls).where(eq(schema.controls.id, controlBId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('le tenant B ne voit rien du tenant A', async () => {
    const rows = await withTenant(app.db, tenantB, (tx) =>
      tx.select().from(schema.controls).where(eq(schema.controls.id, controlAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('les memberships des autres tenants sont invisibles', async () => {
    const rows = await withTenant(app.db, tenantA, (tx) => tx.select().from(schema.memberships));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(aliceId);
  });

  it("un utilisateur n'est visible que depuis les tenants dont il est membre", async () => {
    const emails = await withTenant(app.db, tenantA, async (tx) =>
      (await tx.select().from(schema.users)).map((u) => u.email),
    );
    expect(emails).toContain('alice@tenant-a.example');
    expect(emails).not.toContain('bob@tenant-b.example');
  });
});

describe('isolation en écriture', () => {
  it('INSERT avec un tenant_id forgé est rejeté par la politique RLS', async () => {
    await expectDbError(
      withTenant(app.db, tenantA, (tx) =>
        tx
          .insert(schema.controls)
          .values({ tenantId: tenantB, title: 'Contrôle forgé cross-tenant' }),
      ),
      /row-level security/,
    );
  });

  it("UPDATE d'une ligne d'un autre tenant n'affecte aucune ligne", async () => {
    const updated = await withTenant(app.db, tenantA, (tx) =>
      tx
        .update(schema.controls)
        .set({ title: 'Titre détourné' })
        .where(eq(schema.controls.id, controlBId))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const [check] = await withTenant(app.db, tenantB, (tx) =>
      tx.select().from(schema.controls).where(eq(schema.controls.id, controlBId)),
    );
    expect(check!.title).toBe('MFA sur les accès VPN');
  });

  it("DELETE d'une ligne d'un autre tenant n'affecte aucune ligne", async () => {
    const deleted = await withTenant(app.db, tenantA, (tx) =>
      tx.delete(schema.controls).where(eq(schema.controls.id, controlBId)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it('le rôle applicatif ne peut pas écrire dans users', async () => {
    await expectDbError(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(schema.users).values({ email: 'intrus@exemple.fr' }),
      ),
      /permission denied|row-level security/,
    );
  });

  it('le rôle applicatif ne peut pas créer de tenant', async () => {
    await expectDbError(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(schema.tenants).values({ name: 'Tenant pirate', slug: 'tenant-pirate' }),
      ),
      /permission denied/,
    );
  });
});

describe('accès hors contexte tenant', () => {
  it('toute requête hors withTenant() échoue bruyamment (S4)', async () => {
    await expectDbError(
      app.db.select().from(schema.controls),
      /unrecognized configuration parameter|invalid input syntax/,
    );
  });

  it('withTenant() refuse un identifiant non-UUID', async () => {
    await expect(
      withTenant(app.db, "1'; DROP TABLE controls; --", async () => undefined),
    ).rejects.toThrow(/UUID/);
  });
});

describe('référentiels builtin vs custom', () => {
  it('les builtins sont visibles de tous, les customs restent isolés', async () => {
    await withTenant(app.db, tenantA, (tx) =>
      tx.insert(schema.frameworks).values({
        tenantId: tenantA,
        code: 'exigences_groupe',
        version: 'v1',
        name: 'Exigences internes Groupe A',
        source: 'custom',
      }),
    );
    const codesA = await withTenant(app.db, tenantA, async (tx) =>
      (await tx.select().from(schema.frameworks)).map((f) => f.code).sort(),
    );
    const codesB = await withTenant(app.db, tenantB, async (tx) =>
      (await tx.select().from(schema.frameworks)).map((f) => f.code),
    );
    expect(codesA).toEqual(['exigences_groupe', 'recyf']);
    expect(codesB).toEqual(['recyf']);
  });

  it('un référentiel builtin est immuable pour le rôle applicatif', async () => {
    const updated = await withTenant(app.db, tenantA, (tx) =>
      tx
        .update(schema.frameworks)
        .set({ name: 'Builtin détourné' })
        .where(eq(schema.frameworks.id, builtinFrameworkId))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(app.db, tenantA, (tx) =>
      tx.delete(schema.frameworks).where(eq(schema.frameworks.id, builtinFrameworkId)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });
});

describe('journal d’audit (droits M0-2)', () => {
  it('INSERT et SELECT autorisés, isolés par tenant', async () => {
    await withTenant(app.db, tenantA, (tx) =>
      tx.insert(schema.auditLog).values({
        tenantId: tenantA,
        actorUserId: aliceId,
        action: 'control.create',
        objectType: 'control',
        objectId: controlAId,
      }),
    );
    const fromB = await withTenant(app.db, tenantB, (tx) => tx.select().from(schema.auditLog));
    expect(fromB).toHaveLength(0);
  });

  it('UPDATE et DELETE refusés au rôle applicatif (INSERT only)', async () => {
    await expectDbError(
      withTenant(app.db, tenantA, (tx) =>
        tx.update(schema.auditLog).set({ action: 'falsifié' }),
      ),
      /permission denied/,
    );
    await expectDbError(
      withTenant(app.db, tenantA, (tx) => tx.delete(schema.auditLog)),
      /permission denied/,
    );
  });
});

describe('règles métier en base', () => {
  it('évaluation « non applicable » sans justification : enregistrement refusé (RM §5.3)', async () => {
    const { assessmentId } = await withTenant(app.db, tenantA, async (tx) => {
      const [a] = await tx
        .insert(schema.assessments)
        .values({
          tenantId: tenantA,
          frameworkId: builtinFrameworkId,
          scopeId: scopeAId,
          campaignLabel: 'Campagne ReCyF S2 2026',
        })
        .returning();
      return { assessmentId: a!.id };
    });

    await expectDbError(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(schema.assessmentItems).values({
          tenantId: tenantA,
          assessmentId,
          requirementId: builtinReqId,
          status: 'non_applicable',
        }),
      ),
      /assessment_items_na_justifiee/,
    );

    // Avec justification : accepté
    await withTenant(app.db, tenantA, (tx) =>
      tx.insert(schema.assessmentItems).values({
        tenantId: tenantA,
        assessmentId,
        requirementId: builtinReqId,
        status: 'non_applicable',
        soaJustification: 'Aucun accès distant tiers sur ce périmètre (site unique, pas de VPN).',
      }),
    );
  });

  it('la vue mutualized_controls respecte la RLS du lecteur', async () => {
    // Le contrôle A couvre une exigence ReCyF (builtin) et une exigence custom A
    await withTenant(app.db, tenantA, async (tx) => {
      const [fw] = await tx
        .select()
        .from(schema.frameworks)
        .where(eq(schema.frameworks.code, 'exigences_groupe'));
      const [customReq] = await tx
        .insert(schema.requirements)
        .values({
          tenantId: tenantA,
          frameworkId: fw!.id,
          refId: 'GRP-01',
          titleInternal: 'Revue périodique des habilitations',
        })
        .returning();
      await tx.insert(schema.controlRequirements).values([
        { tenantId: tenantA, controlId: controlAId, requirementId: builtinReqId },
        { tenantId: tenantA, controlId: controlAId, requirementId: customReq!.id },
      ]);
    });

    const seenByA = await withTenant(app.db, tenantA, (tx) =>
      tx.execute(dsql`SELECT control_id, framework_count FROM mutualized_controls`),
    );
    expect(seenByA).toHaveLength(1);

    const seenByB = await withTenant(app.db, tenantB, (tx) =>
      tx.execute(dsql`SELECT control_id, framework_count FROM mutualized_controls`),
    );
    expect(seenByB).toHaveLength(0);
  });
});
