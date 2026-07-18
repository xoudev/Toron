import { createHash } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  createEvidence,
  getEvidenceContent,
  listAccessLog,
  listEvidences,
  listEvidencesCoveringRequirement,
  logAccess,
} from './evidences.ts';

const PG_IMAGE = 'postgres:16.14-alpine3.23';
const T = DEMO.tenantId;
const sha = (s: string) => createHash('sha256').update(Buffer.from(s)).digest('hex');

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

describe('ingestion & fraîcheur', () => {
  it('crée une preuve empreintée et la restitue (SHA-256)', async () => {
    const res = await withTenant(app.db, T, async (tx) => {
      const digest = sha('mon export');
      const id = await createEvidence(tx, {
        tenantId: T,
        title: 'Test — export',
        type: 'export',
        fileName: 'export.txt',
        content: Buffer.from('mon export'),
        sha256: digest,
        collectedAt: '2026-07-01',
        recurrence: 'ponctuelle',
        collectorUserId: DEMO.userClaire,
      });
      const content = await getEvidenceContent(tx, id);
      return { digest, body: content?.content.toString() };
    });
    expect(res.body).toBe('mon export');
    // le digest stocké correspond bien au contenu
    expect(res.digest).toBe(sha('mon export'));
  });

  it('la contrainte refuse une empreinte mal formée', async () => {
    let rejected = false;
    try {
      await admin`
        INSERT INTO evidences (tenant_id, title, sha256, collected_at)
        VALUES (${T}, 'x', 'pas-un-hash', CURRENT_DATE)`;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('liste triée « expirées d’abord » : l’attestation MFA expirée passe en tête', async () => {
    const list = await withTenant(app.db, T, (tx) => listEvidences(tx));
    const expired = list.filter((e) => e.freshness === 'expiree');
    expect(expired.some((e) => e.id === DEMO.evidenceMfa)).toBe(true);
    // Aucune preuve non expirée avant une preuve expirée.
    const firstNonExpired = list.findIndex((e) => e.freshness !== 'expiree');
    const lastExpired = list.map((e) => e.freshness).lastIndexOf('expiree');
    if (firstNonExpired !== -1 && lastExpired !== -1) {
      expect(lastExpired).toBeLessThan(firstNonExpired);
    }
  });
});

describe('mutualisation (CA §5.7)', () => {
  it('une preuve liée à un contrôle mutualisé couvre l’exigence ISO ET ReCyF', async () => {
    const { iso, recyf } = await withTenant(app.db, T, async (tx) => {
      const [a813] = (await tx.execute(
        sql`SELECT id FROM requirements WHERE ref_id = 'A.8.13' LIMIT 1`,
      )) as unknown as { id: string }[];
      const [obj13] = (await tx.execute(
        sql`SELECT id FROM requirements WHERE ref_id = 'OBJ-13' LIMIT 1`,
      )) as unknown as { id: string }[];
      return {
        iso: await listEvidencesCoveringRequirement(tx, a813!.id),
        recyf: await listEvidencesCoveringRequirement(tx, obj13!.id),
      };
    });
    // Le PV de restauration (lié au contrôle Sauvegardes mutualisé) couvre les deux.
    expect(iso.some((e) => e.evidenceId === DEMO.evidenceRestauration && e.viaControl)).toBe(true);
    expect(recyf.some((e) => e.evidenceId === DEMO.evidenceRestauration && e.viaControl)).toBe(true);
  });
});

describe('journal des accès (append-only)', () => {
  it('enregistre consultations/téléchargements et les liste', async () => {
    const log = await withTenant(app.db, T, async (tx) => {
      await logAccess(tx, { tenantId: T, evidenceId: DEMO.evidenceInventaire, userId: DEMO.userClaire, kind: 'telechargement' });
      return listAccessLog(tx, DEMO.evidenceInventaire);
    });
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0]!.kind).toBe('telechargement');
    expect(log[0]!.userName).toBe('Claire Morel');
  });

  it('le journal des accès n’est pas modifiable par le rôle applicatif', async () => {
    let rejected = false;
    try {
      await withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE evidence_access_log SET kind = 'consultation'`));
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

describe('isolation', () => {
  it('les preuves d’un tenant sont invisibles d’un autre (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) =>
      createEvidence(tx, {
        tenantId: T,
        title: 'Preuve isolée',
        type: 'export',
        sha256: sha('iso'),
        collectedAt: '2026-07-01',
        recurrence: 'ponctuelle',
      }),
    );
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers preuve', 'tiers-preuve') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listEvidences(tx));
    expect(seen.some((e) => e.id === id)).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
