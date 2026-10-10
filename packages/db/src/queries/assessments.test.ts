import { scoreAssessment } from '@toron/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import * as schema from '../schema/index.ts';
import { DEMO, seedDemoTenant, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { createAction } from './actions.ts';
import {
  addRequirementToOpenAssessments,
  closeAssessment,
  createAssessment,
  findGapAction,
  getAssessmentItemContext,
  getAssessmentItems,
  getMutualizedPeers,
  getSoaHeader,
  listAssessments,
  setAssessmentItemStatus,
} from './assessments.ts';
import { addCustomRequirement, createControl, createCustomFramework, mapControlToRequirement } from './referentiels.ts';
import { PG_IMAGE } from '../test-image.ts';

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

  it('les exigences pré-exclues entrent « non applicable », hors SoA, avec leur justification', async () => {
    const items = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: recyfFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'ReCyF entité importante',
        excluded: { refs: ['16.1-EE', '20.1-EE'], justification: 'Mesure exigée des seules entités essentielles.' },
      });
      return getAssessmentItems(tx, id);
    });
    const excluded = items.filter((i) => i.status === 'non_applicable');
    expect(excluded.map((i) => i.requirementRef).sort()).toEqual(['16.1-EE', '20.1-EE']);
    expect(excluded.every((i) => !i.soaIncluded && i.soaJustification === 'Mesure exigée des seules entités essentielles.')).toBe(true);
    expect(items.filter((i) => i.status === 'a_evaluer')).toHaveLength(150);
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

describe('contexte d’un item et action corrective d’un écart', () => {
  it('renvoie référentiel, référence, statut et état de la campagne ; null hors campagne', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: isoFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Campagne contexte',
      });
      const items = await getAssessmentItems(tx, id);
      const clause = items.find((i) => i.requirementRef === '6.1.2')!;
      const open = await getAssessmentItemContext(tx, id, clause.requirementId);
      await closeAssessment(tx, id);
      const closed = await getAssessmentItemContext(tx, id, clause.requirementId);
      const [obj] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'OBJ-01'));
      const outside = await getAssessmentItemContext(tx, id, obj!.id);
      return { open, closed, outside };
    });
    expect(result.open).toEqual({ campaignStatus: 'en_cours', frameworkCode: 'iso27001', requirementRef: '6.1.2', status: 'a_evaluer' });
    expect(result.closed?.campaignStatus).toBe('cloturee');
    expect(result.outside).toBeNull();
  });

  it('retrouve l’action déjà ouverte pour un écart de la même campagne, pas celle d’une autre', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: isoFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Campagne écart',
      });
      const req = (await getAssessmentItems(tx, id))[0]!.requirementId;
      const before = await findGapAction(tx, id, req);
      const actionId = await createAction(tx, {
        tenantId: T,
        title: 'Corriger l’écart',
        originType: 'assessment',
        originId: id,
        links: [{ targetType: 'requirement', targetId: req }],
      });
      const found = await findGapAction(tx, id, req);
      const otherCampaign = await findGapAction(tx, '00000000-0000-4000-8000-000000000000', req);
      return { before, actionId, found, otherCampaign };
    });
    expect(result.before).toBeNull();
    expect(result.found).toBe(result.actionId);
    expect(result.otherCampaign).toBeNull();
  });

  it('une action terminée alors que l’écart demeure ne bloque plus une nouvelle action', async () => {
    const found = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: isoFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Campagne correction inefficace',
      });
      const req = (await getAssessmentItems(tx, id))[0]!.requirementId;
      const actionId = await createAction(tx, {
        tenantId: T,
        title: 'Corriger l’écart',
        originType: 'assessment',
        originId: id,
        links: [{ targetType: 'requirement', targetId: req }],
      });
      await tx.update(schema.actions).set({ status: 'termine' }).where(eq(schema.actions.id, actionId));
      return findGapAction(tx, id, req);
    });
    expect(found).toBeNull();
  });
});

describe('exigence ajoutée après le lancement d’une campagne', () => {
  it('entre « à évaluer » dans les campagnes non clôturées du référentiel, pas dans une clôturée', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const fwId = await createCustomFramework(tx, {
        tenantId: T,
        code: 'exigences_internes',
        version: 'v1',
        name: 'Exigences internes Meridiane',
      });
      const open = await createAssessment(tx, { tenantId: T, frameworkId: fwId, scopeId: DEMO.scopeSmsi, campaignLabel: 'Campagne ouverte' });
      const closed = await createAssessment(tx, { tenantId: T, frameworkId: fwId, scopeId: DEMO.scopeSmsi, campaignLabel: 'Campagne close' });
      await closeAssessment(tx, closed);
      const reqId = await addCustomRequirement(tx, {
        tenantId: T,
        frameworkId: fwId,
        ref: 'EI-01',
        title: 'Chiffrer les postes nomades',
      });
      const added = await addRequirementToOpenAssessments(tx, { tenantId: T, frameworkId: fwId, requirementId: reqId });
      const again = await addRequirementToOpenAssessments(tx, { tenantId: T, frameworkId: fwId, requirementId: reqId });
      return {
        added,
        again,
        openItems: await getAssessmentItems(tx, open),
        closedItems: await getAssessmentItems(tx, closed),
        context: await getAssessmentItemContext(tx, open, reqId),
      };
    });
    expect(result.added).toBe(1);
    expect(result.again).toBe(0);
    expect(result.openItems.map((i) => [i.requirementRef, i.status])).toEqual([['EI-01', 'a_evaluer']]);
    expect(result.closedItems).toHaveLength(0);
    expect(result.context?.campaignStatus).toBe('en_cours');
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

describe('getSoaHeader (en-tête de la Déclaration d’applicabilité)', () => {
  it('renvoie référentiel, périmètre et entité de l’organisation', async () => {
    const header = await withTenant(app.db, T, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: T,
        frameworkId: isoFwId,
        scopeId: DEMO.scopeSmsi,
        campaignLabel: 'Campagne en-tête SoA',
      });
      return getSoaHeader(tx, id);
    });
    expect(header?.frameworkName).toBe('ISO/IEC 27001:2022');
    expect(header?.scopeName).toBe('SMSI Groupe');
    expect(header?.entityName).toBe('Meridiane Logistics SAS');
  });

  it('sans entité juridique, l’entité est le nom de l’organisation, pas celui du périmètre', async () => {
    const [tenant] = await admin`INSERT INTO tenants (name, slug) VALUES ('Ateliers Vauban', 'ateliers-vauban-soa') RETURNING id`;
    const tenantId = (tenant as { id: string }).id;
    const [scope] = await admin`
      INSERT INTO scopes (tenant_id, name, kind) VALUES (${tenantId}, 'Périmètre principal', 'smsi') RETURNING id`;
    const header = await withTenant(app.db, tenantId, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId,
        frameworkId: isoFwId,
        scopeId: (scope as { id: string }).id,
        campaignLabel: 'Première évaluation',
      });
      return getSoaHeader(tx, id);
    });
    expect(header?.entityName).toBe('Ateliers Vauban');
    expect(header?.scopeName).toBe('Périmètre principal');
  });
});

describe('pairs mutualisés (suggestion d’héritage)', () => {
  it('A.8.5 (ISO) a pour pair OBJ-08 (ReCyF) via le contrôle MFA de la démo', async () => {
    const peers = await withTenant(app.db, T, async (tx) => {
      const [a85] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'A.8.5'));
      return getMutualizedPeers(tx, a85!.id);
    });
    const nis = peers.find((p) => p.frameworkCode === 'recyf');
    expect(nis?.requirementRef).toBe('OBJ-08');
    expect(nis?.viaControlTitle).toContain('MFA');
    expect(nis?.frameworkId).toBe(recyfFwId);
    // Aucun pair du même référentiel (ISO) — uniquement les autres.
    expect(peers.every((p) => p.frameworkCode !== 'iso27001')).toBe(true);
  });

  it('signale si la campagne qui porte le pair est clôturée ou en cours', async () => {
    const [tenant] = await admin`INSERT INTO tenants (name, slug) VALUES ('Transports Garnier', 'transports-garnier-pairs') RETURNING id`;
    const tenantId = (tenant as { id: string }).id;
    const [scope] = await admin`
      INSERT INTO scopes (tenant_id, name, kind) VALUES (${tenantId}, 'SMSI siège', 'smsi') RETURNING id`;
    const scopeId = (scope as { id: string }).id;
    const result = await withTenant(app.db, tenantId, async (tx) => {
      const refId = async (frameworkId: string, ref: string) =>
        (
          await tx
            .select({ id: schema.requirements.id })
            .from(schema.requirements)
            .where(and(eq(schema.requirements.frameworkId, frameworkId), eq(schema.requirements.refId, ref)))
        )[0]!.id;
      const source = await refId(isoFwId, 'A.5.15');
      const peer = await refId(recyfFwId, '16.1-EE');
      const controlId = await createControl(tx, { tenantId, title: 'Revue des habilitations' });
      await mapControlToRequirement(tx, tenantId, controlId, source);
      await mapControlToRequirement(tx, tenantId, controlId, peer);
      const first = await createAssessment(tx, { tenantId, frameworkId: recyfFwId, scopeId, campaignLabel: 'ReCyF 2025' });
      await closeAssessment(tx, first);
      const closedOnly = (await getMutualizedPeers(tx, source)).find((p) => p.requirementId === peer);
      await createAssessment(tx, { tenantId, frameworkId: recyfFwId, scopeId, campaignLabel: 'ReCyF 2026' });
      const withOpen = (await getMutualizedPeers(tx, source)).find((p) => p.requirementId === peer);
      return { closedOnly, withOpen };
    });
    expect(result.closedOnly).toMatchObject({ currentStatus: 'a_evaluer', campaignOpen: false });
    expect(result.withOpen).toMatchObject({ currentStatus: 'a_evaluer', campaignOpen: true });
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
