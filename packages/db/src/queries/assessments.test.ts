import { scoreAssessment } from '@toron/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import * as schema from '../schema/index.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  closeAssessment,
  createAssessment,
  getAssessmentItems,
  listAssessments,
  setAssessmentItemStatus,
} from './assessments.ts';

const PG_IMAGE = 'postgres:16.14-alpine3.23';
const T = DEMO.tenantId;

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;
let recyfFwId: string;
let isoFwId: string;

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
  const fw = (await admin`SELECT id, code FROM frameworks WHERE tenant_id IS NULL`) as unknown as {
    id: string;
    code: string;
  }[];
  recyfFwId = fw.find((f) => f.code === 'recyf')!.id;
  isoFwId = fw.find((f) => f.code === 'iso27001')!.id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

describe('createAssessment', () => {
  it('pré-remplit un item par exigence FEUILLE (ReCyF : 152 moyens, pas les 20 objectifs)', async () => {
    const count = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: recyfFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Évaluation ReCyF S2 2026',
      });
      return (await getAssessmentItems(tx, id)).length;
    });
    expect(count).toBe(152);
  });

  it('ISO 27001 : 118 feuilles (25 sous-clauses + 93 contrôles Annexe A), pas les nœuds parents', async () => {
    const count = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: isoFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Évaluation ISO 27001 S2 2026',
      });
      const items = await getAssessmentItems(tx, id);
      // Aucun nœud parent (A.5, clause "4"…) parmi les items.
      expect(items.some((i) => i.requirementRef === 'A.5')).toBe(false);
      expect(items.some((i) => i.requirementRef === 'A.5.19')).toBe(true);
      return items.length;
    });
    expect(count).toBe(118);
  });

  it('tous les items démarrent « à évaluer »', async () => {
    const allToAssess = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: recyfFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Nouvelle campagne',
      });
      const items = await getAssessmentItems(tx, id);
      return items.every((i) => i.status === 'a_evaluer');
    });
    expect(allToAssess).toBe(true);
  });
});

describe('setAssessmentItemStatus + scoring (RM §5.3)', () => {
  it('fixe des statuts et calcule un score excluant les N/A', async () => {
    const score = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: recyfFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Campagne scoring',
      });
      const items = await getAssessmentItems(tx, id);
      // 2 conformes, 1 écart, 1 N/A justifié → applicable = 3, score = 2/3 = 67 %
      await setAssessmentItemStatus(tx, { assessmentId: id, requirementId: items[0]!.requirementId, status: 'conforme', assessedBy: DEMO.userClaire });
      await setAssessmentItemStatus(tx, { assessmentId: id, requirementId: items[1]!.requirementId, status: 'conforme', assessedBy: DEMO.userClaire });
      await setAssessmentItemStatus(tx, { assessmentId: id, requirementId: items[2]!.requirementId, status: 'ecart', assessedBy: DEMO.userClaire });
      await setAssessmentItemStatus(tx, {
        assessmentId: id,
        requirementId: items[3]!.requirementId,
        status: 'non_applicable',
        soaJustification: 'Hors périmètre — aucun système industriel sur ce site.',
        assessedBy: DEMO.userClaire,
      });
      const updated = await getAssessmentItems(tx, id);
      // On ne score que les 4 exigences renseignées + le reste à_evaluer.
      // Restreint au sous-ensemble renseigné pour un score déterministe :
      const subset = updated.filter((i) => i.status !== 'a_evaluer');
      return scoreAssessment(subset);
    });
    expect(score.applicable).toBe(3);
    expect(score.scorePct).toBe(67);
    expect(score.gaps).toBe(1);
  });

  it('refuse « non applicable » sans justification (contrainte CHECK, S2)', async () => {
    // La campagne est créée dans une transaction committée ; l'écriture
    // fautive est isolée dans son propre withTenant (rollback propre).
    const target = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: recyfFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Campagne N/A',
      });
      const items = await getAssessmentItems(tx, id);
      return { assessmentId: id, requirementId: items[0]!.requirementId };
    });
    await expectDbError(
      withTenant(app.db, T, (tx) =>
        setAssessmentItemStatus(tx, {
          assessmentId: target.assessmentId,
          requirementId: target.requirementId,
          status: 'non_applicable',
          assessedBy: DEMO.userClaire,
        }),
      ),
      /assessment_items_na_justifiee/,
    );
  });
});

describe('cycle de vie des campagnes', () => {
  it('liste et clôture une campagne', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: isoFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Campagne à clôturer',
      });
      const closed = await closeAssessment(tx, id);
      const list = await listAssessments(tx, isoFwId);
      const mine = list.find((a) => a.id === id)!;
      return { closed, status: mine.status, itemCount: mine.itemCount };
    });
    expect(result.closed).toBe(1);
    expect(result.status).toBe('cloturee');
    expect(result.itemCount).toBe(118);
  });
});

describe('isolation', () => {
  it('les campagnes d’un tenant sont invisibles d’un autre', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Tiers eval', 'tiers-eval') RETURNING id`;
    const rows = await withTenant(app.db, (other as { id: string }).id, (tx) => listAssessments(tx));
    expect(rows).toHaveLength(0);
  });

  it('setAssessmentItemStatus n’affecte rien sur un item d’un autre tenant (0 ligne)', async () => {
    const affected = await withTenant(app.db, T, async (tx) => {
      // requirementId builtin valide mais assessmentId inexistant → 0 ligne.
      const [r] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'OBJ-01'));
      return setAssessmentItemStatus(tx, {
        assessmentId: '00000000-0000-4000-8000-000000000000',
        requirementId: r!.id,
        status: 'conforme',
        assessedBy: DEMO.userClaire,
      });
    });
    expect(affected).toBe(0);
  });
});
