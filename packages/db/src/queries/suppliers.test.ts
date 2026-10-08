import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { listMyWork } from './work.ts';
import {
  addSupplierAttestation,
  createSupplier,
  getSupplierDetail,
  listSuppliers,
  recordSupplierAssessment,
  removeSupplierAttestation,
  updateSupplier,
} from './suppliers.ts';
import { PG_IMAGE } from '../test-image.ts';

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

describe('registre fournisseurs (module 5.10)', () => {
  it('le seed pose 3 fournisseurs triés par criticité (T1 d’abord)', async () => {
    const list = await withTenant(app.db, T, (tx) => listSuppliers(tx));
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0]!.tier).toBe('t1');
    const heb = list.find((s) => s.id === DEMO.supplierHebergeur)!;
    expect(heb.contractStatus).toBe('conforme');
    expect(heb.dataCategories).toContain('Données clients');
  });

  it('création puis mise à jour du statut contractuel', async () => {
    const status = await withTenant(app.db, T, async (tx) => {
      const id = await createSupplier(tx, { tenantId: T, name: 'Test — SaaS', tier: 't2', dataCategories: ['Logs'] });
      await updateSupplier(tx, { supplierId: id, contractStatus: 'conforme' });
      return (await listSuppliers(tx)).find((s) => s.id === id)!.contractStatus;
    });
    expect(status).toBe('conforme');
  });

  it('isolation cross-tenant (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) => createSupplier(tx, { tenantId: T, name: 'Isolé', tier: 't3' }));
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers four', 'tiers-four') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listSuppliers(tx));
    expect(seen.some((s) => s.id === id)).toBe(false);
    expect(seen).toHaveLength(0);
  });
});

describe('évaluations et attestations fournisseurs', () => {
  it('le seed porte une évaluation, des attestations et une action corrective', async () => {
    const list = await withTenant(app.db, T, (tx) => listSuppliers(tx));
    const infog = list.find((s) => s.id === DEMO.supplierInfogerance)!;
    expect(infog.lastRating).toBe('insuffisant');
    expect(infog.lastAssessedOn).toBe('2025-06-20');
    expect(infog.nextAttestationExpiry).toBe('2026-09-15');
    expect(infog.openActionCount).toBe(1);
    expect(infog).toMatchObject({ responsesToReview: 0, openRequestDueOn: '2026-10-30' });
    const transp = list.find((s) => s.id === DEMO.supplierTransporteur)!;
    expect(transp.lastScore).toBeNull();
    expect(transp.attestationCount).toBe(1);
    expect(transp).toMatchObject({ responsesToReview: 1, openRequestDueOn: null });

    const detail = await withTenant(app.db, T, (tx) => getSupplierDetail(tx, DEMO.supplierInfogerance));
    expect(detail!.assessments[0]!.answers.incidents).toBe('non');
    expect(detail!.actions.map((a) => a.id)).toContain(DEMO.actionSupplierIncidents);
    expect(detail!.requests.map((r) => [r.id, r.status])).toEqual([[DEMO.supplierRequestInfogerance, 'envoyee']]);
  });

  it('la dernière évaluation fait foi et l’historique est conservé', async () => {
    const { last, history } = await withTenant(app.db, T, async (tx) => {
      const id = await createSupplier(tx, { tenantId: T, name: 'Éditeur SaaS RH', tier: 't2' });
      const base = { tenantId: T, supplierId: id, assessorUserId: DEMO.userClaire, answers: { mfa: 'non' as const } };
      await recordSupplierAssessment(tx, { ...base, assessedOn: '2025-01-10', score: 40, rating: 'insuffisant' });
      await recordSupplierAssessment(tx, { ...base, assessedOn: '2026-09-01', score: 86, rating: 'satisfaisant' });
      return {
        last: (await listSuppliers(tx)).find((s) => s.id === id)!,
        history: (await getSupplierDetail(tx, id))!.assessments.map((a) => a.score),
      };
    });
    expect(last.lastScore).toBe(86);
    expect(last.lastRating).toBe('satisfaisant');
    expect(history).toEqual([86, 40]);
  });

  it('une évaluation ne se modifie ni ne se supprime', async () => {
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`UPDATE supplier_assessments SET score = 100`)), /permission denied/);
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`DELETE FROM supplier_assessments`)), /permission denied/);
  });

  it('une attestation saisie par erreur peut être retirée', async () => {
    const removed = await withTenant(app.db, T, async (tx) => {
      const id = await addSupplierAttestation(tx, { tenantId: T, supplierId: DEMO.supplierTransporteur, kind: 'autre', label: 'Doublon', createdBy: DEMO.userClaire });
      return removeSupplierAttestation(tx, id);
    });
    expect(removed).toEqual({ supplierId: DEMO.supplierTransporteur, kind: 'autre' });
  });

  it('refuse une validité antérieure à la délivrance et un type inconnu', async () => {
    await expectDbError(withTenant(app.db, T, (tx) => addSupplierAttestation(tx, {
      tenantId: T, supplierId: DEMO.supplierTransporteur, kind: 'iso27001', issuedOn: '2026-05-01', validUntil: '2026-04-01', createdBy: DEMO.userClaire,
    })), /supplier_attestations_dates/);
    await expectDbError(withTenant(app.db, T, (tx) => tx.execute(sql`
      INSERT INTO supplier_attestations (tenant_id, supplier_id, kind) VALUES (${T}, ${DEMO.supplierTransporteur}, 'inconnu')
    `)), /check constraint/);
  });

  it('isolation : pas de lecture croisée ni de rattachement au fournisseur d’une autre organisation', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers éval', 'tiers-eval') RETURNING id`;
    const otherId = (other as { id: string }).id;
    const seen = await withTenant(app.db, otherId, (tx) => getSupplierDetail(tx, DEMO.supplierInfogerance));
    expect(seen).toBeNull();
    const [{ n }] = await withTenant(app.db, otherId, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM supplier_attestations`)) as unknown as [{ n: number }];
    expect(n).toBe(0);
    // La clé composite (fournisseur, organisation) empêche de viser le
    // fournisseur d'une autre organisation, même en connaissant son UUID.
    await expectDbError(withTenant(app.db, otherId, (tx) => addSupplierAttestation(tx, {
      tenantId: otherId, supplierId: DEMO.supplierInfogerance, kind: 'iso27001', createdBy: DEMO.userClaire,
    })), /foreign key/);
    await expectDbError(withTenant(app.db, otherId, (tx) => recordSupplierAssessment(tx, {
      tenantId: otherId, supplierId: DEMO.supplierInfogerance, assessorUserId: DEMO.userClaire, assessedOn: '2026-10-01', answers: {}, score: 100, rating: 'satisfaisant',
    })), /foreign key/);
  });

  it('« Mon travail » retient l’échéance la plus proche : attestation, réévaluation ou revue', async () => {
    const items = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userClaire));
    const infog = items.find((i) => i.kind === 'fournisseur' && i.id === DEMO.supplierInfogerance)!;
    // Réévaluation due le 2026-06-20, avant l'expiration ISO du 2026-09-15.
    expect(infog.due).toBe('2026-06-20');
    expect(infog.detail).toBe('Évaluation à refaire');
    const heb = items.find((i) => i.kind === 'fournisseur' && i.id === DEMO.supplierHebergeur)!;
    expect(heb.due).toBe('2026-10-28');
    expect(heb.detail).toBe('Attestation à renouveler');
  });

  it('« Mon travail » : une réponse reçue par le portail passe avant le reste, datée de son envoi', async () => {
    const items = await withTenant(app.db, T, (tx) => listMyWork(tx, DEMO.userAntoine));
    const transp = items.find((i) => i.kind === 'fournisseur' && i.id === DEMO.supplierTransporteur)!;
    expect(transp).toMatchObject({ due: '2026-10-02', detail: 'Réponse du fournisseur à examiner' });
  });
});
