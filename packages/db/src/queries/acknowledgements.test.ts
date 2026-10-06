import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import { acknowledgeDocument, getAcknowledgementStatus, setAcknowledgementRequired } from './acknowledgements.ts';
import { addVersion, listDocuments, publishVersion } from './documents.ts';
import { listMyWork } from './work.ts';

const T = DEMO.tenantId;
const OTHER = 'e0000000-0000-4000-8000-000000000003';

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
  await admin`CREATE ROLE ack_app LOGIN PASSWORD 'ack_app_test'`;
  await admin`GRANT toron_app TO ack_app`;
  app = createDb(`postgres://ack_app:ack_app_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`);
  await admin`INSERT INTO tenants (id, name, slug) VALUES (${OTHER}, 'Autre', 'autre-ack')`;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

const doc = DEMO.docPssi;

describe('accusés de lecture', () => {
  it('rend un document obligatoire, l’inscrit dans « Mon travail » et enregistre l’acceptation', async () => {
    await withTenant(app.db, T, (tx) => setAcknowledgementRequired(tx, doc, true));
    const before = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userCamille));
    const item = before.find((i) => i.kind === 'lecture' && i.id === doc);
    expect(item?.detail).toMatch(/^Lire et accepter la version /);

    const res = await withTenant(app.db, T, (tx) => acknowledgeDocument(tx, { tenantId: T, documentId: doc, userId: DEMO.userCamille }));
    expect(res.outcome).toBe('accepte');
    const again = await withTenant(app.db, T, (tx) => acknowledgeDocument(tx, { tenantId: T, documentId: doc, userId: DEMO.userCamille }));
    expect(again.outcome).toBe('deja_accepte');

    const after = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userCamille));
    expect(after.some((i) => i.kind === 'lecture' && i.id === doc)).toBe(false);
    const status = await withTenant(app.db, T, (tx) => getAcknowledgementStatus(tx, doc));
    expect(status?.members.find((m) => m.userId === DEMO.userCamille)?.acknowledgedAt).not.toBeNull();
    expect(status?.members.find((m) => m.userId === DEMO.userAntoine)?.acknowledgedAt).toBeNull();
    const listed = (await withTenant(app.db, T, listDocuments)).find((d) => d.id === doc)!;
    expect(listed).toMatchObject({ acknowledgementRequired: true, ackCount: 1 });
  });

  it('une nouvelle version publiée appelle une nouvelle acceptation', async () => {
    const versionId = await withTenant(app.db, T, (tx) => addVersion(tx, { tenantId: T, documentId: doc, semver: '9.0', createdBy: DEMO.userClaire, body: '<p>Révision</p>' }));
    await withTenant(app.db, T, (tx) => publishVersion(tx, versionId));
    const work = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userCamille));
    expect(work.find((i) => i.kind === 'lecture' && i.id === doc)?.detail).toBe('Lire et accepter la version 9.0');
  });

  it('refuse un accusé sur un brouillon et toute modification ou suppression', async () => {
    const draft = await withTenant(app.db, T, (tx) => addVersion(tx, { tenantId: T, documentId: doc, semver: '9.1', createdBy: DEMO.userClaire, body: '<p>Brouillon</p>' }));
    await expect(withTenant(app.db, T, (tx) => tx.execute(
      sql`INSERT INTO document_acknowledgements (tenant_id, version_id, user_id) VALUES (${T}, ${draft}, ${DEMO.userAntoine})`,
    ))).rejects.toThrow();
    await expect(withTenant(app.db, T, (tx) => tx.execute(sql`DELETE FROM document_acknowledgements`))).rejects.toThrow();
    await expect(withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE document_acknowledgements SET acknowledged_at = now()`))).rejects.toThrow();
  });

  it('isole les accusés entre organisations', async () => {
    const fromOther = await withTenant(app.db, OTHER, (tx) => getAcknowledgementStatus(tx, doc));
    expect(fromOther).toBeNull();
    const n = await withTenant(app.db, OTHER, (tx) => setAcknowledgementRequired(tx, doc, false));
    expect(n).toBe(0);
    const seen = (await withTenant(app.db, OTHER, (tx) => tx.execute(sql`SELECT * FROM document_acknowledgements`))) as unknown as unknown[];
    expect(seen).toHaveLength(0);
  });
});
