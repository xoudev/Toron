import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql as sql2 } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  acceptRisk,
  createRisk,
  linkRiskControl,
  listRiskHistory,
  listRisks,
  unlinkRiskControl,
  updateRiskRating,
} from './risks.ts';

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

describe('création & cotation (matrice active)', () => {
  it('crée un risque, pose l’instantané initial et calcule les bandes', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const id = await createRisk(tx, {
        tenantId: T,
        scopeId: DEMO.scopeSmsi,
        title: 'Test — panne SI',
        grossG: 4,
        grossV: 3,
        netG: 3,
        netV: 2,
        treatment: 'reduire',
        ratedBy: DEMO.userClaire,
      });
      const list = await listRisks(tx);
      const mine = list.find((r) => r.id === id)!;
      const history = await listRiskHistory(tx, id);
      return { mine, history };
    });
    // riskBand par défaut : (4,3)=critique (brut), (3,2)=moyen (net).
    expect(result.mine.grossBand).toBe('critique');
    expect(result.mine.netBand).toBe('moyen');
    expect(result.history).toHaveLength(1);
    expect(result.history[0]!.netBand).toBe('moyen');
    expect(result.history[0]!.scaleVersion).toBe(1);
  });

  it('le seed démo pose l’échelle 4×4 et cinq risques triés par gravité nette', async () => {
    const seeded = await withTenant(app.db, T, (tx) => listRisks(tx, DEMO.scopeSmsi));
    const ids = seeded.map((r) => r.id);
    expect(ids).toContain(DEMO.riskRancongiciel);
    expect(ids).toContain(DEMO.riskInventaire);
    // Tri : (net_g*net_v) décroissant — jamais un score inférieur avant un supérieur.
    for (let i = 1; i < seeded.length; i += 1) {
      const prev = seeded[i - 1]!;
      const cur = seeded[i]!;
      expect(prev.netG * prev.netV).toBeGreaterThanOrEqual(cur.netG * cur.netV);
    }
  });
});

describe('historique immuable au changement d’échelle (RM §5.4)', () => {
  it('une nouvelle version d’échelle n’altère pas les bandes historisées', async () => {
    const { history } = await withTenant(app.db, T, async (tx) => {
      const id = await createRisk(tx, {
        tenantId: T,
        scopeId: DEMO.scopeSmsi,
        title: 'Test — historique',
        grossG: 4,
        grossV: 4,
        netG: 4,
        netV: 4,
        treatment: 'reduire',
        ratedBy: DEMO.userClaire,
      });
      // Nouvelle échelle (version 2) : (4,4) devient « moyen » au lieu de « critique ».
      const flat = Array.from({ length: 4 }, () => ['moyen', 'moyen', 'moyen', 'moyen']);
      await tx.execute(sql2`
        INSERT INTO risk_scales (tenant_id, version, size, g_labels, v_labels, bands)
        VALUES (${T}, 2, 4, ${JSON.stringify(['a', 'b', 'c', 'd'])}::jsonb,
                ${JSON.stringify(['a', 'b', 'c', 'd'])}::jsonb, ${JSON.stringify(flat)}::jsonb)`);
      // Re-cotation identique sous l’échelle v2 → nouvel instantané « moyen ».
      await updateRiskRating(tx, {
        riskId: id,
        tenantId: T,
        grossG: 4,
        grossV: 4,
        netG: 4,
        netV: 4,
        ratedBy: DEMO.userClaire,
      });
      const history = await listRiskHistory(tx, id);
      return { history };
    });
    expect(history).toHaveLength(2);
    // Le plus récent (v2) = moyen ; l’ancien (v1) reste critique — non altéré.
    expect(history[0]!.scaleVersion).toBe(2);
    expect(history[0]!.netBand).toBe('moyen');
    expect(history[1]!.scaleVersion).toBe(1);
    expect(history[1]!.netBand).toBe('critique');
  });
});

describe('acceptation formelle (RM §5.4)', () => {
  it('« accepter » sans signature ⇒ acceptation en attente', async () => {
    const state = await withTenant(app.db, T, async (tx) => {
      const id = await createRisk(tx, {
        tenantId: T,
        scopeId: DEMO.scopeSmsi,
        title: 'Test — accepté non signé',
        grossG: 3,
        grossV: 2,
        netG: 2,
        netV: 2,
        treatment: 'accepter',
        ratedBy: DEMO.userClaire,
      });
      return (await listRisks(tx)).find((r) => r.id === id)!.acceptanceState;
    });
    expect(state).toBe('en_attente');
  });

  it('une acceptation signée expose signataire, date et échéance', async () => {
    const mine = await withTenant(app.db, T, async (tx) => {
      const id = await createRisk(tx, {
        tenantId: T,
        scopeId: DEMO.scopeSmsi,
        title: 'Test — accepté signé',
        grossG: 3,
        grossV: 2,
        netG: 2,
        netV: 2,
        treatment: 'accepter',
        ratedBy: DEMO.userClaire,
      });
      await acceptRisk(tx, {
        tenantId: T,
        riskId: id,
        acceptedByUser: DEMO.userAntoine,
        rationale: 'Impact résiduel jugé tolérable par la direction.',
        expiresAt: '2027-12-31',
      });
      return (await listRisks(tx)).find((r) => r.id === id)!;
    });
    expect(mine.acceptanceState).toBe('acceptee');
    expect(mine.acceptedByName).toBe('Antoine Vasseur');
    expect(mine.acceptanceExpiresAt).toBe('2027-12-31');
    expect(mine.acceptedAt).toBeInstanceOf(Date);
  });

  it('une acceptation dont l’échéance est passée ⇒ expirée', async () => {
    const state = await withTenant(app.db, T, async (tx) => {
      const id = await createRisk(tx, {
        tenantId: T,
        scopeId: DEMO.scopeSmsi,
        title: 'Test — acceptation expirée',
        grossG: 3,
        grossV: 2,
        netG: 2,
        netV: 2,
        treatment: 'accepter',
        ratedBy: DEMO.userClaire,
      });
      await acceptRisk(tx, {
        tenantId: T,
        riskId: id,
        acceptedByUser: DEMO.userAntoine,
        rationale: 'Acceptation historique non revalidée.',
        expiresAt: '2025-01-01',
      });
      return (await listRisks(tx)).find((r) => r.id === id)!.acceptanceState;
    });
    expect(state).toBe('expiree');
  });
});

describe('contrôles atténuants', () => {
  it('rattache puis détache un contrôle, le compteur suit', async () => {
    const counts = await withTenant(app.db, T, async (tx) => {
      const id = await createRisk(tx, {
        tenantId: T,
        scopeId: DEMO.scopeSmsi,
        title: 'Test — contrôles',
        grossG: 3,
        grossV: 3,
        netG: 2,
        netV: 2,
        treatment: 'reduire',
        ratedBy: DEMO.userClaire,
      });
      await linkRiskControl(tx, { tenantId: T, riskId: id, controlId: DEMO.controlMfa });
      await linkRiskControl(tx, { tenantId: T, riskId: id, controlId: DEMO.controlMfa }); // idempotent
      const after = (await listRisks(tx)).find((r) => r.id === id)!.controlCount;
      const removed = await unlinkRiskControl(tx, { riskId: id, controlId: DEMO.controlMfa });
      const final = (await listRisks(tx)).find((r) => r.id === id)!.controlCount;
      return { after, removed, final };
    });
    expect(counts.after).toBe(1);
    expect(counts.removed).toBe(1);
    expect(counts.final).toBe(0);
  });
});

describe('immuabilité (append-only) & isolation', () => {
  it('l’historique des cotations n’est pas modifiable par le rôle applicatif', async () => {
    await expectDbError(
      withTenant(app.db, T, (tx) => tx.execute(sql2`UPDATE risk_history SET net_g = 1`)),
      /permission denied|risk_history/i,
    );
  });

  it('les signatures d’acceptation ne sont pas modifiables par le rôle applicatif', async () => {
    await expectDbError(
      withTenant(app.db, T, (tx) => tx.execute(sql2`UPDATE risk_acceptances SET rationale = 'x'`)),
      /permission denied|risk_acceptances/i,
    );
  });

  it('les risques d’un tenant sont invisibles d’un autre (RLS)', async () => {
    const id = await withTenant(app.db, T, (tx) =>
      createRisk(tx, {
        tenantId: T,
        scopeId: DEMO.scopeSmsi,
        title: 'Test — isolation',
        grossG: 2,
        grossV: 2,
        netG: 1,
        netV: 1,
        treatment: 'reduire',
        ratedBy: DEMO.userClaire,
      }),
    );
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers risque', 'tiers-risque') RETURNING id`;
    const seen = await withTenant(app.db, (other as { id: string }).id, (tx) => listRisks(tx));
    expect(seen.some((r) => r.id === id)).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
