import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  createExport,
  failExport,
  getExport,
  getExportPdf,
  sealExport,
  verifyExport,
} from './exports.ts';

const PG_IMAGE = 'postgres:16.14-alpine3.23';
const T = DEMO.tenantId;
const SHA = 'a'.repeat(64);

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

describe('cycle de vie d’un export scellé', () => {
  it('crée « en cours », scelle, puis expose PDF et vérification', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const id = await createExport(tx, {
        tenantId: T,
        type: 'soa',
        objectRef: DEMO.scopeSmsi,
        requestedBy: DEMO.userClaire,
      });
      const before = await getExport(tx, id);
      const sealed = await sealExport(tx, {
        exportId: id,
        pdf: Buffer.from('%PDF-1.7 fake'),
        sha256: SHA,
        verifySlug: 'demo-slug-0001',
      });
      const after = await getExport(tx, id);
      const pdf = await getExportPdf(tx, id);
      return { id, beforeStatus: before?.status, sealed, afterStatus: after?.status, pdf };
    });
    expect(result.beforeStatus).toBe('en_cours');
    expect(result.sealed).toBe(1);
    expect(result.afterStatus).toBe('scelle');
    expect(result.pdf?.sha256).toBe(SHA);
    expect(result.pdf?.pdf.toString()).toContain('%PDF');
  });

  it('la contrainte refuse un export « scellé » incomplet (sans empreinte)', async () => {
    await expect(
      admin`
        INSERT INTO exports (tenant_id, type, status, verify_slug, sealed_at)
        VALUES (${T}, 'soa', 'scelle', 'x', now())`,
    ).rejects.toThrow(/exports_scelle_complet/);
  });

  it('marque un export en échec avec une cause', async () => {
    const status = await withTenant(app.db, T, async (tx) => {
      const id = await createExport(tx, { tenantId: T, type: 'soa', objectRef: DEMO.scopeSmsi, requestedBy: DEMO.userClaire });
      await failExport(tx, id, 'compilation Typst échouée');
      return (await getExport(tx, id))?.status;
    });
    expect(status).toBe('echec');
  });
});

describe('vérification publique du poinçon (ADR-6)', () => {
  it('verify_export résout un slug scellé sans contexte tenant, champs sûrs uniquement', async () => {
    await withTenant(app.db, T, async (tx) => {
      const id = await createExport(tx, { tenantId: T, type: 'soa', objectRef: DEMO.scopeSmsi, requestedBy: DEMO.userClaire });
      await sealExport(tx, { exportId: id, pdf: Buffer.from('pdf'), sha256: SHA, verifySlug: 'public-verify-slug' });
    });
    // Appel SANS withTenant : la fonction SECURITY DEFINER contourne la RLS.
    const verified = await verifyExport(app.db, 'public-verify-slug');
    expect(verified?.type).toBe('soa');
    expect(verified?.sha256).toBe(SHA);
    expect(verified?.sealedAt).toBeInstanceOf(Date);
  });

  it('renvoie null pour un slug inconnu ou un export non scellé', async () => {
    const unknown = await verifyExport(app.db, 'slug-inexistant');
    expect(unknown).toBeNull();
    const enCoursSlug = await withTenant(app.db, T, async (tx) => {
      const id = await createExport(tx, { tenantId: T, type: 'soa', objectRef: DEMO.scopeSmsi, requestedBy: DEMO.userClaire });
      // en_cours : pas de slug, donc rien à vérifier
      return id;
    });
    expect(enCoursSlug).toBeTruthy();
    expect(await verifyExport(app.db, 'en-cours-jamais-scelle')).toBeNull();
  });
});

describe('isolation', () => {
  it('les exports d’un tenant sont invisibles d’un autre (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) =>
      createExport(tx, { tenantId: T, type: 'soa', objectRef: DEMO.scopeSmsi, requestedBy: DEMO.userClaire }),
    );
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers export', 'tiers-export') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => getExport(tx, id));
    expect(seen).toBeNull();
  });
});
