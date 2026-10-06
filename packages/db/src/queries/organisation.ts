import { randomUUID } from 'node:crypto';

import { defaultDisabledModules, normalizeDisabledModules, type OptionalModule, type ScopeKind } from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import { writeAuditEntry } from '../audit.ts';
import type { Db } from '../client.ts';
import * as schema from '../schema/index.ts';
import { withTenant, type TenantTx } from '../tenant.ts';

export interface OrganisationProfile {
  id: string; name: string; slug: string; employeeCount: number | null;
  sector: string | null; region: string; plan: string; createdAt: Date;
  disabledModules: OptionalModule[];
  scopeCount: number; siteCount: number; entityCount: number;
}

export async function getOrganisationProfile(tx: TenantTx): Promise<OrganisationProfile> {
  const [row] = await tx.select({
    id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug,
    employeeCount: schema.tenants.employeeCount, sector: schema.tenants.sector,
    region: schema.tenants.region, plan: schema.tenants.plan, createdAt: schema.tenants.createdAt,
    disabledModules: schema.tenants.disabledModules,
    scopeCount: sql<number>`(select count(*)::integer from scopes)`,
    siteCount: sql<number>`(select count(*)::integer from sites)`,
    entityCount: sql<number>`(select count(*)::integer from legal_entities)`,
  }).from(schema.tenants);
  if (!row) throw new Error('Organisation introuvable.');
  return { ...row, disabledModules: normalizeDisabledModules(row.disabledModules) };
}

/** Modules masqués de l'organisation courante (liste normalisée, dépendances comprises). */
export async function setDisabledModules(tx: TenantTx, modules: readonly string[]): Promise<OptionalModule[]> {
  const normalized = normalizeDisabledModules(modules);
  await tx.update(schema.tenants).set({ disabledModules: normalized });
  return normalized;
}

export async function updateOrganisationProfile(tx: TenantTx, input: {
  name: string; employeeCount: number | null; sector: string | null;
}): Promise<void> {
  // Le contexte RLS détermine l'unique organisation modifiable.
  await tx.update(schema.tenants).set(input);
}

// ── Entités juridiques et sites ─────────────────────────────────────────

export interface LegalEntityRow { id: string; name: string; siren: string | null; siteCount: number }
export interface SiteRow { id: string; entityId: string; entityName: string; name: string; address: string | null }

export async function listLegalEntities(tx: TenantTx): Promise<LegalEntityRow[]> {
  return tx.select({
    id: schema.legalEntities.id, name: schema.legalEntities.name, siren: schema.legalEntities.siren,
    siteCount: sql<number>`(select count(*)::integer from sites s where s.entity_id = legal_entities.id)`,
  }).from(schema.legalEntities).orderBy(schema.legalEntities.name);
}

export async function saveLegalEntity(tx: TenantTx, input: {
  tenantId: string; id?: string; name: string; siren: string | null;
}): Promise<string> {
  if (input.id) {
    const [row] = await tx.update(schema.legalEntities).set({ name: input.name, siren: input.siren })
      .where(eq(schema.legalEntities.id, input.id)).returning({ id: schema.legalEntities.id });
    if (!row) throw new Error('Entité introuvable dans cette organisation.');
    return row.id;
  }
  const [row] = await tx.insert(schema.legalEntities)
    .values({ tenantId: input.tenantId, name: input.name, siren: input.siren })
    .returning({ id: schema.legalEntities.id });
  return row!.id;
}

/** Refuse la suppression tant que des sites y sont rattachés. */
export async function deleteLegalEntity(tx: TenantTx, id: string): Promise<'supprimee' | 'sites_rattaches' | 'introuvable'> {
  const [count] = await tx.select({ n: sql<number>`count(*)::integer` }).from(schema.sites).where(eq(schema.sites.entityId, id));
  if ((count?.n ?? 0) > 0) return 'sites_rattaches';
  const rows = await tx.delete(schema.legalEntities).where(eq(schema.legalEntities.id, id)).returning({ id: schema.legalEntities.id });
  return rows.length > 0 ? 'supprimee' : 'introuvable';
}

export async function listSites(tx: TenantTx): Promise<SiteRow[]> {
  return tx.select({
    id: schema.sites.id, entityId: schema.sites.entityId, entityName: schema.legalEntities.name,
    name: schema.sites.name, address: schema.sites.address,
  }).from(schema.sites)
    .innerJoin(schema.legalEntities, eq(schema.legalEntities.id, schema.sites.entityId))
    .orderBy(schema.legalEntities.name, schema.sites.name);
}

export async function saveSite(tx: TenantTx, input: {
  tenantId: string; id?: string; entityId: string; name: string; address: string | null;
}): Promise<string> {
  if (input.id) {
    const [row] = await tx.update(schema.sites).set({ entityId: input.entityId, name: input.name, address: input.address })
      .where(eq(schema.sites.id, input.id)).returning({ id: schema.sites.id });
    if (!row) throw new Error('Site introuvable dans cette organisation.');
    return row.id;
  }
  const [row] = await tx.insert(schema.sites)
    .values({ tenantId: input.tenantId, entityId: input.entityId, name: input.name, address: input.address })
    .returning({ id: schema.sites.id });
  return row!.id;
}

export async function deleteSite(tx: TenantTx, id: string): Promise<boolean> {
  // Les périmètres référencent les sites par tableau : on retire le site de
  // chaque périmètre avant de le supprimer, dans la même transaction.
  await tx.execute(sql`UPDATE scopes SET site_ids = array_remove(site_ids, ${id}::uuid) WHERE ${id}::uuid = ANY(site_ids)`);
  const rows = await tx.delete(schema.sites).where(eq(schema.sites.id, id)).returning({ id: schema.sites.id });
  return rows.length > 0;
}

// ── Périmètres ──────────────────────────────────────────────────────────

export interface ScopeDetail {
  id: string; name: string; kind: ScopeKind; entityIds: string[]; siteIds: string[];
  frameworkCount: number; riskCount: number; createdAt: Date;
}

export async function listScopeDetails(tx: TenantTx): Promise<ScopeDetail[]> {
  const rows = await tx.select({
    id: schema.scopes.id, name: schema.scopes.name, kind: schema.scopes.kind,
    entityIds: schema.scopes.entityIds, siteIds: schema.scopes.siteIds, createdAt: schema.scopes.createdAt,
    frameworkCount: sql<number>`(select count(*)::integer from scope_frameworks sf where sf.scope_id = scopes.id)`,
    riskCount: sql<number>`(select count(*)::integer from risks r where r.scope_id = scopes.id)`,
  }).from(schema.scopes).orderBy(schema.scopes.name);
  return rows.map((r) => ({ ...r, kind: r.kind as ScopeKind }));
}

export async function saveOrganisationScope(tx: TenantTx, input: {
  tenantId: string; id?: string; name: string; kind: ScopeKind; entityIds?: string[]; siteIds?: string[];
}): Promise<string> {
  const values = { name: input.name, kind: input.kind, entityIds: input.entityIds ?? [], siteIds: input.siteIds ?? [] };
  if (input.id) {
    const [row] = await tx.update(schema.scopes).set(values)
      .where(eq(schema.scopes.id, input.id)).returning({ id: schema.scopes.id });
    if (!row) throw new Error('Périmètre introuvable dans cette organisation.');
    return row.id;
  }
  const [row] = await tx.insert(schema.scopes).values({ tenantId: input.tenantId, ...values })
    .returning({ id: schema.scopes.id });
  return row!.id;
}

/**
 * Un périmètre qui porte des objets métier ne se supprime pas : on
 * renvoie ce qui le retient pour que l'interface l'explique.
 */
export async function deleteOrganisationScope(tx: TenantTx, id: string): Promise<
  { outcome: 'supprime' } | { outcome: 'introuvable' } | { outcome: 'utilise'; references: string[] }
> {
  const [usage] = (await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM risks WHERE scope_id = ${id}::uuid) AS risks,
      (SELECT count(*) FROM assessments WHERE scope_id = ${id}::uuid) AS assessments,
      (SELECT count(*) FROM documents WHERE scope_id = ${id}::uuid) AS documents,
      (SELECT count(*) FROM assets WHERE scope_id = ${id}::uuid) AS assets,
      (SELECT count(*) FROM audits WHERE scope_id = ${id}::uuid) AS audits,
      (SELECT count(*) FROM ebios_studies WHERE scope_id = ${id}::uuid) AS ebios
  `)) as unknown as Record<string, string>[];
  const labels: Record<string, [string, string]> = {
    risks: ['risque', 'risques'], assessments: ['campagne d’évaluation', 'campagnes d’évaluation'],
    documents: ['document', 'documents'], assets: ['actif', 'actifs'], audits: ['audit', 'audits'],
    ebios: ['étude EBIOS RM', 'études EBIOS RM'],
  };
  const references = Object.entries(usage ?? {})
    .map(([k, v]) => [k, Number(v)] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${labels[k]![n > 1 ? 1 : 0]}`);
  if (references.length > 0) return { outcome: 'utilise', references };
  const rows = await tx.delete(schema.scopes).where(eq(schema.scopes.id, id)).returning({ id: schema.scopes.id });
  return rows.length > 0 ? { outcome: 'supprime' } : { outcome: 'introuvable' };
}

// ── Création d'une organisation ─────────────────────────────────────────

/** Opération système : employer le rôle d'auth, jamais le rôle applicatif. */
export async function createTenantWithOwner(db: Db, input: {
  name: string; baseSlug: string; userId: string; scopeName: string; scopeKind: ScopeKind;
}): Promise<{ id: string; slug: string }> {
  const tenantId = randomUUID();
  return withTenant(db, tenantId, async (tx) => {
    let tenant: { id: string; slug: string } | undefined;
    // ON CONFLICT n'annule pas la transaction : deux créations simultanées
    // reçoivent chacune une URL disponible, sans tenant orphelin.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const slug = attempt === 0 ? input.baseSlug : `${input.baseSlug}-${attempt + 1}`;
      [tenant] = await tx.insert(schema.tenants).values({ id: tenantId, name: input.name, slug, disabledModules: defaultDisabledModules(input.scopeKind) })
        .onConflictDoNothing({ target: schema.tenants.slug })
        .returning({ id: schema.tenants.id, slug: schema.tenants.slug });
      if (tenant) break;
    }
    if (!tenant) throw new Error('Nom d’organisation déjà utilisé — choisissez un nom plus distinctif.');
    await tx.insert(schema.memberships).values({ tenantId, userId: input.userId, role: 'owner' });
    await tx.insert(schema.scopes).values({ tenantId, name: input.scopeName, kind: input.scopeKind });
    await writeAuditEntry(tx, {
      tenantId, actorUserId: input.userId, action: 'organisation.create',
      objectType: 'organisation', objectId: tenantId,
      after: { name: input.name, scopeName: input.scopeName, scopeKind: input.scopeKind },
    });
    return tenant;
  });
}
