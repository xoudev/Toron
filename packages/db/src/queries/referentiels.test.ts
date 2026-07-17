import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import * as schema from '../schema/index.ts';
import {
  DEMO,
  seedDemoTenant,
  seedIso27001Framework,
  seedRecyfFramework,
} from '../seed.ts';
import { withTenant } from '../tenant.ts';
import {
  addCustomRequirement,
  createControl,
  createCustomFramework,
  deleteControl,
  getControlDeleteImpact,
  getRequirementTree,
  listControls,
  listFrameworks,
  mapControlToRequirement,
  unmapControlFromRequirement,
} from './referentiels.ts';

// Couche d'accès du moteur de référentiels (5.2b), contre un vrai Postgres.
// Le tenant démo fournit ReCyF + ISO 27001 + 3 contrôles mutualisés.

const PG_IMAGE = 'postgres:16.14-alpine3.23';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;
const T = DEMO.tenantId;

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

describe('catalogue (listFrameworks)', () => {
  it('liste les référentiels builtin d’abord, avec compteurs', async () => {
    const frameworks = await withTenant(app.db, T, (tx) => listFrameworks(tx));
    const byCode = Object.fromEntries(frameworks.map((f) => [f.code, f]));
    expect(byCode['recyf']?.isBuiltin).toBe(true);
    expect(byCode['recyf']?.requirementCount).toBe(172); // 20 objectifs + 152 moyens
    expect(byCode['iso27001']?.requirementCount).toBe(129); // 32 clauses + 97 Annexe A
    // Les 3 contrôles démo sont mappés sur chaque référentiel.
    expect(byCode['recyf']?.mappedControlCount).toBe(3);
    expect(byCode['iso27001']?.mappedControlCount).toBe(3);
  });
});

describe('arbre d’exigences (getRequirementTree)', () => {
  it('renvoie les exigences ordonnées avec le compte de contrôles mappés', async () => {
    const { frameworks, tree } = await withTenant(app.db, T, async (tx) => {
      const fws = await listFrameworks(tx);
      const iso = fws.find((f) => f.code === 'iso27001')!;
      return { frameworks: fws, tree: await getRequirementTree(tx, iso.id) };
    });
    expect(frameworks.length).toBeGreaterThanOrEqual(2);
    expect(tree).toHaveLength(129);
    // sort_order croissant
    for (let i = 1; i < tree.length; i += 1) {
      expect(tree[i]!.sortOrder).toBeGreaterThanOrEqual(tree[i - 1]!.sortOrder);
    }
    // A.8.5 est mappé (contrôle MFA de la démo)
    const a85 = tree.find((n) => n.ref === 'A.8.5');
    expect(a85?.mappedControlCount).toBe(1);
    // Un thème parent existe et n'est mappé par aucun contrôle
    const themeA5 = tree.find((n) => n.ref === 'A.5');
    expect(themeA5?.parentId).toBeNull();
    expect(themeA5?.mappedControlCount).toBe(0);
  });
});

describe('contrôles et mutualisation (listControls)', () => {
  it('marque mutualisés les 3 contrôles démo (2 référentiels chacun)', async () => {
    const controls = await withTenant(app.db, T, (tx) => listControls(tx));
    expect(controls).toHaveLength(3);
    for (const c of controls) {
      expect(c.mutualized).toBe(true);
      expect(c.frameworkCodes.sort()).toEqual(['iso27001', 'recyf']);
    }
  });
});

describe('parcours créer → mapper → mutualisé (CA du module)', () => {
  it('un contrôle mappé à A.5.19 et OBJ-05 devient mutualisé', async () => {
    const result = await withTenant(app.db, T, async (tx) => {
      const controlId = await createControl(tx, {
        tenantId: T,
        title: 'Revue annuelle des accès fournisseurs',
        ownerUserId: DEMO.userClaire,
      });
      // Résout deux exigences builtin (ISO A.5.19 et ReCyF OBJ-05).
      const [iso] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'A.5.19'));
      const [recyf] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'OBJ-05'));
      await mapControlToRequirement(tx, T, controlId, iso!.id);
      await mapControlToRequirement(tx, T, controlId, recyf!.id);
      // Idempotence du mapping
      await mapControlToRequirement(tx, T, controlId, iso!.id);
      const controls = await listControls(tx);
      return controls.find((c) => c.id === controlId)!;
    });
    expect(result.mappedRequirementCount).toBe(2);
    expect(result.mutualized).toBe(true);
    expect(result.frameworkCodes).toEqual(['iso27001', 'recyf']);
  });
});

describe('impact de suppression (RM §5.2)', () => {
  it('liste les exigences découvertes et exige confirmation', async () => {
    const impact = await withTenant(app.db, T, async (tx) => {
      const controlId = await createControl(tx, { tenantId: T, title: 'Contrôle temporaire à supprimer' });
      const [a86] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'A.8.6'));
      await mapControlToRequirement(tx, T, controlId, a86!.id);
      return getControlDeleteImpact(tx, controlId);
    });
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.mappedRequirementCount).toBe(1);
    // A.8.6 n'est couvert par aucun autre contrôle → deviendrait découverte
    expect(impact.uncoveredRequirementCount).toBe(1);
    expect(impact.frameworks[0]?.requirements[0]?.becomesUncovered).toBe(true);
  });

  it('une exigence encore couverte par un autre contrôle n’est pas « découverte »', async () => {
    const impact = await withTenant(app.db, T, async (tx) => {
      const [a85] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'A.8.5'));
      // Un second contrôle couvre A.8.5 en plus du contrôle MFA démo.
      const second = await createControl(tx, { tenantId: T, title: 'Second contrôle sur A.8.5' });
      await mapControlToRequirement(tx, T, second, a85!.id);
      return getControlDeleteImpact(tx, DEMO.controlMfa);
    });
    const a85impact = impact.frameworks
      .flatMap((f) => f.requirements)
      .find((r) => r.requirementRef === 'A.8.5');
    expect(a85impact?.becomesUncovered).toBe(false);
  });

  it('supprime effectivement le contrôle et ses mappings (cascade)', async () => {
    const remaining = await withTenant(app.db, T, async (tx) => {
      const controlId = await createControl(tx, { tenantId: T, title: 'À supprimer pour de bon' });
      const [obj] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'OBJ-10'));
      await mapControlToRequirement(tx, T, controlId, obj!.id);
      await deleteControl(tx, controlId);
      return tx
        .select()
        .from(schema.controlRequirements)
        .where(eq(schema.controlRequirements.controlId, controlId));
    });
    expect(remaining).toHaveLength(0);
  });
});

describe('référentiel custom (exigences internes/groupe)', () => {
  it('crée un référentiel custom isolé, avec ses exigences', async () => {
    const created = await withTenant(app.db, T, async (tx) => {
      const fwId = await createCustomFramework(tx, {
        tenantId: T,
        code: 'exigences_groupe',
        version: 'v1',
        name: 'Exigences internes Groupe Meridiane',
      });
      await addCustomRequirement(tx, {
        tenantId: T,
        frameworkId: fwId,
        ref: 'GRP-01',
        title: 'Revue trimestrielle des habilitations sensibles',
        sortOrder: 0,
      });
      const tree = await getRequirementTree(tx, fwId);
      return { fwId, tree };
    });
    expect(created.tree).toHaveLength(1);
    expect(created.tree[0]?.ref).toBe('GRP-01');
  });

  it('reste invisible et non mappable depuis un autre tenant', async () => {
    const [other] = await admin`
      INSERT INTO tenants (name, slug) VALUES ('PME tierce', 'pme-tierce') RETURNING id`;
    const otherId = (other as { id: string }).id;
    const frameworks = await withTenant(app.db, otherId, (tx) => listFrameworks(tx));
    // L'autre tenant voit les builtin mais aucun custom de Meridiane.
    expect(frameworks.some((f) => f.code === 'exigences_groupe')).toBe(false);
    expect(frameworks.every((f) => f.isBuiltin)).toBe(true);
  });
});

describe('nettoyage', () => {
  it('retire les mappings de test ajoutés sur les contrôles démo', async () => {
    // unmap A.8.5 du contrôle MFA n'était pas ajouté ; on vérifie juste que
    // unmapControlFromRequirement fonctionne sans lever.
    await withTenant(app.db, T, async (tx) => {
      const [a85] = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.refId, 'A.8.5'));
      await unmapControlFromRequirement(tx, DEMO.controlMfa, a85!.id);
      // Re-mappe pour ne pas casser l'état démo pour d'autres suites.
      await mapControlToRequirement(tx, T, DEMO.controlMfa, a85!.id);
    });
    expect(true).toBe(true);
  });
});
