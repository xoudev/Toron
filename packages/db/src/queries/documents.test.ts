import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  addVersion,
  createDocument,
  getVersionContent,
  linkRequirement,
  listDocuments,
  listDocumentsCoveringRequirement,
  listVersions,
  publishVersion,
} from './documents.ts';

const PG_IMAGE = 'postgres:16.14-alpine3.23';
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

describe('cycle de vie d’un document versionné', () => {
  it('crée un document, ajoute une version, la publie et la télécharge', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const docId = await createDocument(tx, { tenantId: T, type: 'politique', title: 'Test — charte' });
      const vId = await addVersion(tx, {
        tenantId: T,
        documentId: docId,
        semver: '1.0',
        fileName: 'charte.txt',
        content: Buffer.from('contenu de charte'),
        createdBy: DEMO.userClaire,
      });
      const published = await publishVersion(tx, vId);
      const versions = await listVersions(tx, docId);
      const content = await getVersionContent(tx, vId);
      return { published, status: versions[0]!.status, body: content?.content.toString() };
    });
    expect(res.published).toBe(1);
    expect(res.status).toBe('publie');
    expect(res.body).toBe('contenu de charte');
  });
});

describe('immuabilité d’une version publiée (RM §5.6)', () => {
  it('une version publiée ne peut plus être modifiée (trigger)', async () => {
    const vId = await withTenant(app.db, T, async (tx) => {
      const docId = await createDocument(tx, { tenantId: T, type: 'procedure', title: 'Test — immuable' });
      const id = await addVersion(tx, { tenantId: T, documentId: docId, semver: '1.0', createdBy: DEMO.userClaire });
      await publishVersion(tx, id);
      return id;
    });
    await expectDbError(
      withTenant(app.db, T, (tx) =>
        tx.execute(sql`UPDATE document_versions SET file_name = 'x' WHERE id = ${vId}`),
      ),
      /version_publiee_immuable/,
    );
  });

  it('publishVersion n’affecte pas une version déjà publiée (0 ligne)', async () => {
    const second = await withTenant(app.db, T, async (tx) => {
      const docId = await createDocument(tx, { tenantId: T, type: 'procedure', title: 'Test — republish' });
      const id = await addVersion(tx, { tenantId: T, documentId: docId, semver: '1.0', createdBy: DEMO.userClaire });
      await publishVersion(tx, id);
      return publishVersion(tx, id); // déjà publiée → 0
    });
    expect(second).toBe(0);
  });
});

describe('liste & couverture SoA', () => {
  it('le seed démo expose la procédure avec revue dépassée et sa dernière version', async () => {
    const docs = await withTenant(app.db, T, (tx) => listDocuments(tx));
    const proc = docs.find((d) => d.id === DEMO.docProcSauvegarde)!;
    expect(proc.reviewOverdue).toBe(true);
    expect(proc.versionCount).toBe(2);
    expect(proc.latestSemver).toBe('1.1'); // le brouillon le plus récent
    expect(proc.latestStatus).toBe('brouillon');
    const pssi = docs.find((d) => d.id === DEMO.docPssi)!;
    expect(pssi.reviewOverdue).toBe(false);
    expect(pssi.latestStatus).toBe('publie');
  });

  it('les documents couvrant une exigence remontent (alimentation SoA, RM §5.6)', async () => {
    const covering = await withTenant(app.db, T, async (tx) => {
      const [req] = (await tx.execute(
        sql`SELECT id FROM requirements WHERE ref_id = 'A.5.1' LIMIT 1`,
      )) as unknown as { id: string }[];
      const docId = await createDocument(tx, { tenantId: T, type: 'politique', title: 'Test — couvre A.5.1' });
      await linkRequirement(tx, { tenantId: T, documentId: docId, requirementId: req!.id });
      return listDocumentsCoveringRequirement(tx, req!.id);
    });
    expect(covering.some((c) => c.title === 'Test — couvre A.5.1')).toBe(true);
    // La PSSI de démo couvre aussi A.5.1.
    expect(covering.some((c) => c.documentId === DEMO.docPssi)).toBe(true);
  });
});

describe('isolation', () => {
  it('les documents d’un tenant sont invisibles d’un autre (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) =>
      createDocument(tx, { tenantId: T, type: 'autre', title: 'Doc isolé' }),
    );
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers doc', 'tiers-doc') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listDocuments(tx));
    expect(seen.some((d) => d.id === id)).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
