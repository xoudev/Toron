import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { PG_IMAGE } from '../test-image.ts';
import { withTenant } from '../tenant.ts';
import {
  createTenantWithOwner, deleteLegalEntity, deleteOrganisationScope, deleteSite, getOrganisationProfile,
  listLegalEntities, listScopeDetails, listSites, saveLegalEntity, saveOrganisationScope, saveSite,
  updateOrganisationProfile,
} from './organisation.ts';
import { exportTenantData, exportedTableNames } from './tenant-export.ts';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: DbHandle;
let auth: DbHandle;
let userId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  await applyMigrations(container.getConnectionUri());
  admin = postgres(container.getConnectionUri(), { max: 1 });
  await admin`CREATE ROLE organisation_app LOGIN PASSWORD 'test_app'`;
  await admin`GRANT toron_app TO organisation_app`;
  await admin`CREATE ROLE organisation_auth LOGIN PASSWORD 'test_auth'`;
  await admin`GRANT toron_auth TO organisation_auth`;
  const host = `${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
  app = createDb(`postgres://organisation_app:test_app@${host}`);
  auth = createDb(`postgres://organisation_auth:test_auth@${host}`);
  const [user] = await admin`INSERT INTO users (email, name) VALUES ('setup@example.test', 'Responsable test') RETURNING id`;
  userId = user!.id as string;
});

afterAll(async () => {
  await app?.close(); await auth?.close(); await admin?.end(); await container?.stop();
});

const input = () => ({ name: 'Organisation test', baseSlug: 'organisation-test', userId, scopeName: 'Périmètre principal', scopeKind: 'mixte' as const });

describe('démarrage d’une organisation', () => {
  it('crée propriétaire, périmètre et trace dans la même transaction sous le rôle auth', async () => {
    const tenant = await createTenantWithOwner(auth.db, input());
    const profile = await withTenant(app.db, tenant.id, getOrganisationProfile);
    expect(profile.scopeCount).toBe(1);
    expect(profile.employeeCount).toBeNull();
    const [member] = await admin`SELECT role FROM memberships WHERE tenant_id = ${tenant.id}`;
    expect(member!.role).toBe('owner');
    const entries = await admin`SELECT action FROM audit_log WHERE tenant_id = ${tenant.id}`;
    expect(entries.map((entry) => entry.action)).toEqual(['organisation.create']);
  });
  it('attribue des URL distinctes lors de créations concurrentes', async () => {
    const tenants = await Promise.all([createTenantWithOwner(auth.db, input()), createTenantWithOwner(auth.db, input())]);
    expect(new Set(tenants.map((tenant) => tenant.slug)).size).toBe(2);
  });
  it('annule le tenant si le propriétaire est invalide', async () => {
    await expect(createTenantWithOwner(auth.db, { ...input(), baseSlug: 'rollback-test', userId: '00000000-0000-4000-8000-000000000099' })).rejects.toThrow();
    expect(await admin`SELECT id FROM tenants WHERE slug = 'rollback-test'`).toHaveLength(0);
  });
  it('interdit au rôle auth de lire les périmètres hors contexte et au rôle app de créer un tenant', async () => {
    const { scopes } = await import('../schema/tenancy.ts');
    expect(await auth.db.select().from(scopes)).toHaveLength(0);
    await expect(createTenantWithOwner(app.db, input())).rejects.toThrow();
  });
  it('isole les mises à jour du profil et des périmètres entre organisations', async () => {
    const a = await createTenantWithOwner(auth.db, input());
    const b = await createTenantWithOwner(auth.db, input());
    const scopeId = await withTenant(app.db, b.id, (tx) => saveOrganisationScope(tx, { tenantId: b.id, name: 'Site B', kind: 'smsi' }));
    await expect(withTenant(app.db, a.id, (tx) => saveOrganisationScope(tx, { tenantId: a.id, id: scopeId, name: 'Intrusion', kind: 'qms' }))).rejects.toThrow();
    await withTenant(app.db, a.id, (tx) => updateOrganisationProfile(tx, { name: 'Organisation A', employeeCount: 45, sector: 'Services' }));
    expect((await withTenant(app.db, a.id, getOrganisationProfile)).employeeCount).toBe(45);
    expect((await withTenant(app.db, b.id, getOrganisationProfile)).employeeCount).toBeNull();
  });
});

describe('entités, sites et périmètres', () => {
  it('gère entités et sites et retire un site supprimé des périmètres', async () => {
    const t = await createTenantWithOwner(auth.db, { ...input(), baseSlug: 'structure' });
    const entityId = await withTenant(app.db, t.id, (tx) => saveLegalEntity(tx, { tenantId: t.id, name: 'Structure SAS', siren: '123456789' }));
    const siteId = await withTenant(app.db, t.id, (tx) => saveSite(tx, { tenantId: t.id, entityId, name: 'Siège', address: 'Lyon' }));
    expect(await withTenant(app.db, t.id, (tx) => deleteLegalEntity(tx, entityId))).toBe('sites_rattaches');

    const [scope] = await withTenant(app.db, t.id, listScopeDetails);
    await withTenant(app.db, t.id, (tx) => saveOrganisationScope(tx, { tenantId: t.id, id: scope!.id, name: scope!.name, kind: 'mixte', entityIds: [entityId], siteIds: [siteId] }));
    expect((await withTenant(app.db, t.id, listScopeDetails))[0]!.siteIds).toEqual([siteId]);

    expect(await withTenant(app.db, t.id, (tx) => deleteSite(tx, siteId))).toBe(true);
    expect((await withTenant(app.db, t.id, listScopeDetails))[0]!.siteIds).toEqual([]);
    expect(await withTenant(app.db, t.id, listSites)).toHaveLength(0);
    expect(await withTenant(app.db, t.id, (tx) => deleteLegalEntity(tx, entityId))).toBe('supprimee');
    expect(await withTenant(app.db, t.id, listLegalEntities)).toHaveLength(0);
  });

  it('refuse de supprimer un périmètre qui porte des objets et explique pourquoi', async () => {
    const t = await createTenantWithOwner(auth.db, { ...input(), baseSlug: 'perimetres' });
    const [scope] = await withTenant(app.db, t.id, listScopeDetails);
    const [fw] = await admin`SELECT id FROM frameworks LIMIT 1`;
    if (!fw) {
      await admin`INSERT INTO frameworks (tenant_id, code, version, name, source) VALUES (NULL, 'test', '1', 'Test', 'builtin')`;
    }
    const [framework] = await admin`SELECT id FROM frameworks LIMIT 1`;
    await admin`INSERT INTO assessments (tenant_id, scope_id, framework_id, campaign_label) VALUES (${t.id}, ${scope!.id}, ${framework!.id}, 'Campagne')`;
    const blocked = await withTenant(app.db, t.id, (tx) => deleteOrganisationScope(tx, scope!.id));
    expect(blocked).toMatchObject({ outcome: 'utilise', references: ['1 campagne d’évaluation'] });

    const empty = await withTenant(app.db, t.id, (tx) => saveOrganisationScope(tx, { tenantId: t.id, name: 'Vide', kind: 'qms' }));
    expect(await withTenant(app.db, t.id, (tx) => deleteOrganisationScope(tx, empty))).toEqual({ outcome: 'supprime' });
    expect(await withTenant(app.db, t.id, (tx) => deleteOrganisationScope(tx, empty))).toEqual({ outcome: 'introuvable' });
  });
});

describe('export complet des données', () => {
  it('n’exporte que les tables de l’organisation courante, sans contenu binaire', async () => {
    const a = await createTenantWithOwner(auth.db, { ...input(), baseSlug: 'export-a' });
    const b = await createTenantWithOwner(auth.db, { ...input(), baseSlug: 'export-b' });
    await admin`INSERT INTO exports (tenant_id, type, status, pdf) VALUES (${b.id}, 'soa', 'en_cours', decode('255044462d', 'hex'))`;

    const names = exportedTableNames();
    expect(names).toContain('scopes');
    expect(names).toContain('audit_log');
    expect(names).not.toContain('users');
    expect(names).not.toContain('sessions');

    const fromA = await withTenant(app.db, a.id, (tx) => exportTenantData(tx));
    expect(fromA.counts['scopes']).toBe(1);
    expect(fromA.counts['exports']).toBe(0);
    expect((fromA.tables['scopes']![0] as { tenant_id: string }).tenant_id).toBe(a.id);

    const fromB = await withTenant(app.db, b.id, (tx) => exportTenantData(tx));
    const exported = fromB.tables['exports']![0]!;
    expect(exported).not.toHaveProperty('pdf');
    expect(exported['pdf_bytes']).toBe(5);
    expect(typeof exported['pdf_sha256']).toBe('string');
    expect(fromB.tables['memberships']!.every((m) => (m as { tenant_id: string }).tenant_id === b.id)).toBe(true);
  });
});
