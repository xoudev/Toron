import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { controlTemplates } from '@toron/frameworks';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { seedFrameworkCatalog, seedIso27001Framework, seedRecyfFramework } from '../seed.ts';
import { withTenant } from '../tenant.ts';
import { PG_IMAGE } from '../test-image.ts';
import {
  activeFrameworkCoverage,
  adoptControlTemplates,
  listAdoptedTemplateKeys,
  syncTemplateMappings,
} from './control-templates.ts';
import { listControlLibrary, updateControl } from './control-reviews.ts';
import { activateFrameworkOnScope } from './referentiels.ts';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;

const templates = controlTemplates();

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  const uri = container.getConnectionUri();
  await applyMigrations(uri);
  await seedRecyfFramework(uri);
  await seedIso27001Framework(uri);
  await seedFrameworkCatalog(uri);
  admin = postgres(uri, { max: 1, onnotice: () => {} });
  await admin`CREATE ROLE app_login LOGIN PASSWORD 'app_login_test'`;
  await admin`GRANT toron_app TO app_login`;
  app = createDb(`postgres://app_login:app_login_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await container?.stop();
});

/** Organisation vide avec un périmètre SMSI. */
async function newTenant(slug: string): Promise<{ tenantId: string; scopeId: string }> {
  const [t] = await admin`INSERT INTO tenants (name, slug) VALUES (${slug}, ${slug}) RETURNING id`;
  const tenantId = (t as { id: string }).id;
  const [s] = await admin`INSERT INTO scopes (tenant_id, name, kind) VALUES (${tenantId}, 'Périmètre principal', 'smsi') RETURNING id`;
  return { tenantId, scopeId: (s as { id: string }).id };
}

async function frameworkId(code: string): Promise<string> {
  const [f] = await admin`SELECT id FROM frameworks WHERE tenant_id IS NULL AND code = ${code}`;
  return (f as { id: string }).id;
}

const activate = (tenantId: string, scopeId: string, code: string) =>
  frameworkId(code).then((fid) => withTenant(app.db, tenantId, (tx) => activateFrameworkOnScope(tx, tenantId, scopeId, fid)));

const coverage = (tenantId: string) => withTenant(app.db, tenantId, (tx) => activeFrameworkCoverage(tx));

describe('reprise des contrôles types', () => {
  it('crée chaque modèle en brouillon et outille toutes les exigences d’ISO 27001 activé', async () => {
    const { tenantId, scopeId } = await newTenant('types-iso');
    await activate(tenantId, scopeId, 'iso27001');
    expect(await coverage(tenantId)).toMatchObject([{ code: 'iso27001', leafCount: 118, coveredRefs: [] }]);

    const res = await withTenant(app.db, tenantId, (tx) => adoptControlTemplates(tx, { tenantId, templates }));
    expect(res.created).toHaveLength(templates.length);
    expect(res.skipped).toBe(0);
    expect(res.mappings).toBeGreaterThanOrEqual(118);

    const [iso] = await coverage(tenantId);
    expect(iso!.coveredRefs).toHaveLength(118);

    const rows = await admin`SELECT status, review_frequency, template_key, description FROM controls WHERE tenant_id = ${tenantId}` as unknown as
      { status: string; review_frequency: string; template_key: string; description: string }[];
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['brouillon']));
    expect(rows.every((r) => r.review_frequency && r.template_key && r.description.includes('Preuve attendue :'))).toBe(true);
    // ReCyF n'est pas activé : aucun rattachement vers ses moyens.
    const [recyfMaps] = await admin`
      SELECT count(*)::int AS n FROM control_requirements cr JOIN requirements r ON r.id = cr.requirement_id
        JOIN frameworks f ON f.id = r.framework_id WHERE cr.tenant_id = ${tenantId} AND f.code = 'recyf'`;
    expect((recyfMaps as { n: number }).n).toBe(0);
  });

  it('une seconde reprise ne duplique rien', async () => {
    const { tenantId, scopeId } = await newTenant('types-idempotent');
    await activate(tenantId, scopeId, 'iso27001');
    const first = templates.slice(0, 5);
    await withTenant(app.db, tenantId, (tx) => adoptControlTemplates(tx, { tenantId, templates: first }));
    const again = await withTenant(app.db, tenantId, (tx) => adoptControlTemplates(tx, { tenantId, templates }));
    expect(again.skipped).toBe(5);
    expect(again.created).toHaveLength(templates.length - 5);
    expect((await withTenant(app.db, tenantId, (tx) => listAdoptedTemplateKeys(tx))).sort()).toEqual(templates.map((t) => t.key).sort());
  });

  it('activer ReCyF plus tard rattache les contrôles déjà repris à ses 152 moyens', async () => {
    const { tenantId, scopeId } = await newTenant('types-recyf');
    await activate(tenantId, scopeId, 'iso27001');
    await withTenant(app.db, tenantId, (tx) => adoptControlTemplates(tx, { tenantId, templates }));
    await activate(tenantId, scopeId, 'recyf');
    const fid = await frameworkId('recyf');
    const added = await withTenant(app.db, tenantId, (tx) => syncTemplateMappings(tx, { tenantId, frameworkId: fid, templates }));
    expect(added).toBeGreaterThanOrEqual(152);
    const recyf = (await coverage(tenantId)).find((c) => c.code === 'recyf')!;
    expect(recyf).toMatchObject({ leafCount: 152 });
    expect(recyf.coveredRefs).toHaveLength(152);
    // Rejouer la synchronisation n'ajoute rien.
    expect(await withTenant(app.db, tenantId, (tx) => syncTemplateMappings(tx, { tenantId, frameworkId: fid, templates }))).toBe(0);
  });

  it('les référentiels du catalogue activés sont rattachés aussi (RGPD)', async () => {
    const { tenantId, scopeId } = await newTenant('types-rgpd');
    await activate(tenantId, scopeId, 'rgpd');
    await withTenant(app.db, tenantId, (tx) => adoptControlTemplates(tx, { tenantId, templates }));
    const rgpd = (await coverage(tenantId)).find((c) => c.code === 'rgpd')!;
    expect(rgpd.coveredRefs.length).toBe(rgpd.leafCount);
  });

  it('un contrôle rattaché à un objectif outille les moyens qui en relèvent', async () => {
    const { tenantId, scopeId } = await newTenant('types-objectif');
    await activate(tenantId, scopeId, 'recyf');
    const [obj] = await admin`
      SELECT r.id FROM requirements r JOIN frameworks f ON f.id = r.framework_id
       WHERE f.tenant_id IS NULL AND f.code = 'recyf' AND r.ref_id = 'OBJ-08'`;
    const [ctl] = await admin`INSERT INTO controls (tenant_id, title) VALUES (${tenantId}, 'Accès distants') RETURNING id`;
    await admin`INSERT INTO control_requirements (control_id, requirement_id, tenant_id) VALUES (${(ctl as { id: string }).id}, ${(obj as { id: string }).id}, ${tenantId})`;
    const recyf = (await coverage(tenantId)).find((c) => c.code === 'recyf')!;
    expect(recyf.coveredRefs).toEqual(['8.1-EI/EE', '8.2-EI/EE', '8.3-EE', '8.4-EE', '8.5-EE']);
  });

  it('deux reprises simultanées ne se gênent pas : chaque modèle est créé une seule fois', async () => {
    const { tenantId, scopeId } = await newTenant('types-concurrence');
    await activate(tenantId, scopeId, 'iso27001');
    const [a, b] = await Promise.all([0, 1].map(() =>
      withTenant(app.db, tenantId, (tx) => adoptControlTemplates(tx, { tenantId, templates }))));
    expect(a!.created.length + b!.created.length).toBe(templates.length);
    expect(a!.skipped + b!.skipped).toBe(templates.length);
    const [n] = await admin`SELECT count(*)::int AS n FROM controls WHERE tenant_id = ${tenantId}`;
    expect((n as { n: number }).n).toBe(templates.length);
  });

  it('un contrôle archivé n’outille plus rien', async () => {
    const { tenantId, scopeId } = await newTenant('types-archive');
    await activate(tenantId, scopeId, 'iso27001');
    await withTenant(app.db, tenantId, (tx) => adoptControlTemplates(tx, { tenantId, templates: templates.filter((t) => t.key === 'postes.bureau_net') }));
    expect((await coverage(tenantId))[0]!.coveredRefs).toEqual(['A.7.7']);
    await admin`UPDATE controls SET status = 'archive' WHERE tenant_id = ${tenantId}`;
    expect((await coverage(tenantId))[0]!.coveredRefs).toEqual([]);
  });

  it('activé longtemps après la reprise, un contrôle n’est pas aussitôt en retard de revue', async () => {
    const { tenantId, scopeId } = await newTenant('types-activation');
    await activate(tenantId, scopeId, 'iso27001');
    const tpl = templates.find((t) => t.key === 'postes.malveillants')!;
    expect(tpl.frequency).toBe('mensuelle');
    const { created } = await withTenant(app.db, tenantId, (tx) => adoptControlTemplates(tx, { tenantId, templates: [tpl] }));
    const id = created[0]!.id;
    // Repris il y a six mois, adapté puis activé aujourd'hui.
    await admin`UPDATE controls SET created_at = now() - interval '6 months' WHERE id = ${id}`;
    await withTenant(app.db, tenantId, (tx) => updateControl(tx, {
      controlId: id, title: tpl.title, description: null, ownerUserId: null, reviewFrequency: 'mensuelle', status: 'actif',
    }));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [row] = await withTenant(app.db, tenantId, (tx) => listControlLibrary(tx, today));
    expect(row).toMatchObject({ status: 'actif' });
    expect(row!.reviewState).not.toBe('en_retard');
    expect(row!.nextReviewOn! > today).toBe(true);
    // Une nouvelle mise à jour du contrôle déjà actif ne déplace pas la date d'activation.
    const activatedOn = async () => ((await admin`SELECT activated_on::text FROM controls WHERE id = ${id}`)[0] as { activated_on: string }).activated_on;
    const first = await activatedOn();
    await withTenant(app.db, tenantId, (tx) => updateControl(tx, {
      controlId: id, title: `${tpl.title} (adapté)`, description: null, ownerUserId: null, reviewFrequency: 'mensuelle', status: 'actif',
    }));
    expect(await activatedOn()).toBe(first);
  });

  it('une clé de modèle mal formée est refusée par la base', async () => {
    const { tenantId } = await newTenant('types-cle');
    await expect(admin`INSERT INTO controls (tenant_id, title, template_key) VALUES (${tenantId}, 'Contrôle', 'Pas une clé')`).rejects.toThrow(/check constraint/);
  });
});

describe('isolation entre organisations', () => {
  it('chaque organisation reprend ses propres contrôles, sans voir ni toucher ceux d’une autre', async () => {
    const a = await newTenant('types-iso-a');
    const b = await newTenant('types-iso-b');
    await activate(a.tenantId, a.scopeId, 'iso27001');
    await withTenant(app.db, a.tenantId, (tx) => adoptControlTemplates(tx, { tenantId: a.tenantId, templates }));
    // L'organisation B ne voit aucun modèle repris, et peut reprendre les mêmes.
    expect(await withTenant(app.db, b.tenantId, (tx) => listAdoptedTemplateKeys(tx))).toEqual([]);
    expect(await coverage(b.tenantId)).toEqual([]);
    await activate(b.tenantId, b.scopeId, 'recyf');
    const resB = await withTenant(app.db, b.tenantId, (tx) => adoptControlTemplates(tx, { tenantId: b.tenantId, templates: templates.slice(0, 3) }));
    expect(resB.created).toHaveLength(3);
    // Synchroniser chez B n'ajoute aucun rattachement aux contrôles de A.
    const before = await admin`SELECT count(*)::int AS n FROM control_requirements WHERE tenant_id = ${a.tenantId}`;
    await withTenant(app.db, b.tenantId, (tx) => syncTemplateMappings(tx, { tenantId: b.tenantId, frameworkId: '00000000-0000-0000-0000-000000000000', templates }));
    const recyfId = await frameworkId('recyf');
    await withTenant(app.db, b.tenantId, (tx) => syncTemplateMappings(tx, { tenantId: b.tenantId, frameworkId: recyfId, templates }));
    const after = await admin`SELECT count(*)::int AS n FROM control_requirements WHERE tenant_id = ${a.tenantId}`;
    expect((after[0] as { n: number }).n).toBe((before[0] as { n: number }).n);
    const aCount = await admin`SELECT count(*)::int AS n FROM controls WHERE tenant_id = ${a.tenantId}`;
    expect((aCount[0] as { n: number }).n).toBe(templates.length);
  });
});
