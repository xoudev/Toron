import type { ControlTemplate } from '@toron/frameworks';
import { sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Contrôles types (module 5.2) ────────────────────────────────────────
// Reprise des contrôles types Toron par une organisation : chaque modèle
// devient un contrôle de l'organisation, en brouillon (à adapter), rattaché
// aux exigences des référentiels intégrés qu'elle a activés. Les
// rattachements vers un référentiel activé plus tard se complètent à son
// activation.

/** Clés des contrôles types déjà repris par l'organisation courante. */
export async function listAdoptedTemplateKeys(tx: TenantTx): Promise<string[]> {
  const rows = (await tx.execute(sql`SELECT template_key FROM controls WHERE template_key IS NOT NULL`)) as unknown as { template_key: string }[];
  return rows.map((r) => r.template_key);
}

/**
 * Exigences feuilles des référentiels intégrés activés par l'organisation
 * (ou d'un seul), indexées par « code|version|référence ».
 */
async function activeRequirementIndex(tx: TenantTx, frameworkId?: string): Promise<Map<string, string>> {
  const rows = (await tx.execute(sql`
    SELECT r.id, f.code, f.version, r.ref_id
      FROM requirements r
      JOIN frameworks f ON f.id = r.framework_id
     WHERE f.tenant_id IS NULL
       AND EXISTS (SELECT 1 FROM scope_frameworks sf WHERE sf.framework_id = f.id)
       ${frameworkId ? sql`AND f.id = ${frameworkId}` : sql``}
  `)) as unknown as { id: string; code: string; version: string; ref_id: string }[];
  return new Map(rows.map((r) => [`${r.code}|${r.version}|${r.ref_id}`, r.id]));
}

function requirementIds(t: ControlTemplate, index: Map<string, string>): string[] {
  const ids = new Set<string>();
  for (const m of t.mappings) {
    for (const ref of m.refs) {
      const id = index.get(`${m.framework}|${m.version}|${ref}`);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

async function insertMappings(tx: TenantTx, tenantId: string, controlId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx.insert(schema.controlRequirements)
    .values(ids.map((requirementId) => ({ tenantId, controlId, requirementId })))
    .onConflictDoNothing()
    .returning({ requirementId: schema.controlRequirements.requirementId });
  return rows.length;
}

export interface TemplateAdoption {
  /** Contrôles créés, avec la clé de leur modèle. */
  created: { id: string; key: string }[];
  /** Modèles déjà repris auparavant, laissés tels quels. */
  skipped: number;
  /** Rattachements posés vers les exigences des référentiels actifs. */
  mappings: number;
}

/**
 * Reprend les contrôles types choisis. Un modèle déjà repris n'est pas
 * dupliqué ; le contrôle créé reste en brouillon tant que l'organisation ne
 * l'a pas adapté et activé.
 */
export async function adoptControlTemplates(tx: TenantTx, input: { tenantId: string; templates: readonly ControlTemplate[] }): Promise<TemplateAdoption> {
  const adopted = new Set(await listAdoptedTemplateKeys(tx));
  const index = await activeRequirementIndex(tx);
  const result: TemplateAdoption = { created: [], skipped: 0, mappings: 0 };
  for (const t of input.templates) {
    if (adopted.has(t.key)) {
      result.skipped += 1;
      continue;
    }
    const [row] = await tx.insert(schema.controls).values({
      tenantId: input.tenantId,
      title: t.title,
      description: `${t.description}\n\nPreuve attendue : ${t.evidence}`,
      reviewFrequency: t.frequency,
      status: 'brouillon',
      templateKey: t.key,
    }).returning({ id: schema.controls.id });
    result.created.push({ id: row!.id, key: t.key });
    result.mappings += await insertMappings(tx, input.tenantId, row!.id, requirementIds(t, index));
  }
  return result;
}

/**
 * Référentiel tout juste activé : les contrôles déjà repris des modèles y
 * sont rattachés à leur tour. Renvoie le nombre de rattachements ajoutés.
 */
export async function syncTemplateMappings(tx: TenantTx, input: { tenantId: string; frameworkId: string; templates: readonly ControlTemplate[] }): Promise<number> {
  const controls = (await tx.execute(sql`SELECT id, template_key FROM controls WHERE template_key IS NOT NULL`)) as unknown as
    { id: string; template_key: string }[];
  if (controls.length === 0) return 0;
  const index = await activeRequirementIndex(tx, input.frameworkId);
  if (index.size === 0) return 0;
  const byKey = new Map(input.templates.map((t) => [t.key, t]));
  let added = 0;
  for (const c of controls) {
    const t = byKey.get(c.template_key);
    if (t) added += await insertMappings(tx, input.tenantId, c.id, requirementIds(t, index));
  }
  return added;
}

export interface ActiveFrameworkCoverage {
  frameworkId: string;
  code: string;
  version: string;
  name: string;
  /**
   * Exigences feuilles (hors chapitres et objectifs), et celles déjà
   * outillées : un contrôle rattaché à l'exigence, ou à son chapitre ou son
   * objectif (rattachement de haut niveau, admis par l'écran), la couvre.
   */
  leafCount: number;
  coveredRefs: string[];
}

/** Couverture actuelle des référentiels intégrés activés, pour l'aperçu de la reprise. */
export async function activeFrameworkCoverage(tx: TenantTx): Promise<ActiveFrameworkCoverage[]> {
  const rows = (await tx.execute(sql`
    SELECT f.id, f.code, f.version, f.name,
           (SELECT count(*) FROM requirements r WHERE r.framework_id = f.id
              AND NOT EXISTS (SELECT 1 FROM requirements c WHERE c.parent_id = r.id))::int AS leaf_count,
           coalesce((SELECT array_agg(r.ref_id ORDER BY r.ref_id) FROM requirements r WHERE r.framework_id = f.id
              AND NOT EXISTS (SELECT 1 FROM requirements c WHERE c.parent_id = r.id)
              AND EXISTS (SELECT 1 FROM control_requirements cr WHERE cr.requirement_id IN (
                    r.id, r.parent_id, (SELECT p.parent_id FROM requirements p WHERE p.id = r.parent_id)))), '{}') AS covered_refs
      FROM frameworks f
     WHERE f.tenant_id IS NULL
       AND EXISTS (SELECT 1 FROM scope_frameworks sf WHERE sf.framework_id = f.id)
     ORDER BY f.code
  `)) as unknown as { id: string; code: string; version: string; name: string; leaf_count: number; covered_refs: string[] }[];
  return rows.map((r) => ({
    frameworkId: r.id, code: r.code, version: r.version, name: r.name, leafCount: r.leaf_count, coveredRefs: r.covered_refs,
  }));
}
