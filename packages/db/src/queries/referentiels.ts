import { controlDeleteImpact, type ControlDeleteImpact, type CoveredRequirement } from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès du moteur de référentiels (module 5.2) ──────────────
// Toutes les fonctions opèrent sur une TenantTx : le contexte tenant est
// déjà posé par withTenant(), la RLS filtre lecture et écriture. Aucune
// n'ouvre de connexion — c'est l'appelant (server action) qui décide du
// périmètre transactionnel.

export interface FrameworkSummary {
  id: string;
  code: string;
  version: string;
  name: string;
  source: 'builtin' | 'custom';
  isBuiltin: boolean;
  requirementCount: number;
  /** Exigences dotées d'au moins un contrôle interne (couverture structurelle, pas conformité). */
  mappedRequirementCount: number;
  /** Contrôles internes distincts rattachés à une exigence de ce référentiel. */
  mappedControlCount: number;
  /** Nombre de périmètres du tenant sur lesquels le référentiel est activé (0 = disponible). */
  activatedScopeCount: number;
}

// Compteurs par sous-requête corrélée : évite le fan-out d'une jointure
// multiple (requirements × control_requirements × scope_frameworks) qui
// fausserait les DISTINCT. Toutes les tables jointes sont filtrées par la
// RLS du tenant courant ; requirements/frameworks restent visibles builtin+tenant.
const FRAMEWORK_COLUMNS = sql`
  f.id, f.code, f.version, f.name, f.source,
  (f.tenant_id IS NULL) AS is_builtin,
  (SELECT count(*) FROM requirements r WHERE r.framework_id = f.id) AS requirement_count,
  (SELECT count(*) FROM requirements r WHERE r.framework_id = f.id
     AND EXISTS (SELECT 1 FROM control_requirements cr WHERE cr.requirement_id = r.id)
  ) AS mapped_requirement_count,
  (SELECT count(DISTINCT cr.control_id) FROM control_requirements cr
     JOIN requirements r ON r.id = cr.requirement_id WHERE r.framework_id = f.id
  ) AS mapped_control_count,
  (SELECT count(*) FROM scope_frameworks sf WHERE sf.framework_id = f.id) AS activated_scope_count
`;

function toFrameworkSummary(r: RawFramework): FrameworkSummary {
  return {
    id: r.id,
    code: r.code,
    version: r.version,
    name: r.name,
    source: r.source,
    isBuiltin: r.is_builtin,
    requirementCount: Number(r.requirement_count),
    mappedRequirementCount: Number(r.mapped_requirement_count),
    mappedControlCount: Number(r.mapped_control_count),
    activatedScopeCount: Number(r.activated_scope_count),
  };
}

/** Catalogue des référentiels visibles du tenant (builtin + custom), builtin d'abord. */
export async function listFrameworks(tx: TenantTx): Promise<FrameworkSummary[]> {
  const rows = await tx.execute(sql`
    SELECT ${FRAMEWORK_COLUMNS}
    FROM frameworks f
    ORDER BY is_builtin DESC, f.code
  `);
  return (rows as unknown as RawFramework[]).map(toFrameworkSummary);
}

/** Un référentiel visible du tenant, ou null (id inconnu / hors tenant via RLS). */
export async function getFramework(tx: TenantTx, frameworkId: string): Promise<FrameworkSummary | null> {
  const rows = await tx.execute(sql`
    SELECT ${FRAMEWORK_COLUMNS}
    FROM frameworks f
    WHERE f.id = ${frameworkId}
  `);
  const list = rows as unknown as RawFramework[];
  return list.length > 0 ? toFrameworkSummary(list[0]!) : null;
}

interface RawFramework {
  id: string;
  code: string;
  version: string;
  name: string;
  source: 'builtin' | 'custom';
  is_builtin: boolean;
  requirement_count: string | number;
  mapped_requirement_count: string | number;
  mapped_control_count: string | number;
  activated_scope_count: string | number;
}

export interface ScopeSummary {
  id: string;
  name: string;
  kind: 'smsi' | 'qms' | 'mixte';
}

/** Périmètres de management du tenant (pour activer un référentiel). */
export async function listScopes(tx: TenantTx): Promise<ScopeSummary[]> {
  const rows = await tx
    .select({ id: schema.scopes.id, name: schema.scopes.name, kind: schema.scopes.kind })
    .from(schema.scopes)
    .orderBy(schema.scopes.name);
  return rows;
}

/** Active un référentiel sur un périmètre (idempotent). */
export async function activateFrameworkOnScope(
  tx: TenantTx,
  tenantId: string,
  scopeId: string,
  frameworkId: string,
): Promise<void> {
  await tx
    .insert(schema.scopeFrameworks)
    .values({ tenantId, scopeId, frameworkId })
    .onConflictDoNothing();
}

export interface RequirementNode {
  id: string;
  ref: string;
  parentId: string | null;
  title: string;
  guidance: string | null;
  sortOrder: number;
  mappedControlCount: number;
}

/**
 * Arbre plat des exigences d'un référentiel (ordonné par sort_order),
 * avec le nombre de contrôles du tenant mappés sur chacune. L'UI
 * reconstruit l'arbre depuis parentId.
 */
export async function getRequirementTree(
  tx: TenantTx,
  frameworkId: string,
): Promise<RequirementNode[]> {
  const rows = await tx.execute(sql`
    SELECT
      r.id, r.ref_id, r.parent_id, r.title_internal, r.guidance_internal, r.sort_order,
      count(cr.control_id) AS mapped_control_count
    FROM requirements r
    LEFT JOIN control_requirements cr ON cr.requirement_id = r.id
    WHERE r.framework_id = ${frameworkId}
    GROUP BY r.id, r.ref_id, r.parent_id, r.title_internal, r.guidance_internal, r.sort_order
    ORDER BY r.sort_order
  `);
  return (rows as unknown as RawRequirement[]).map((r) => ({
    id: r.id,
    ref: r.ref_id,
    parentId: r.parent_id,
    title: r.title_internal,
    guidance: r.guidance_internal,
    sortOrder: Number(r.sort_order),
    mappedControlCount: Number(r.mapped_control_count),
  }));
}

interface RawRequirement {
  id: string;
  ref_id: string;
  parent_id: string | null;
  title_internal: string;
  guidance_internal: string | null;
  sort_order: string | number;
  mapped_control_count: string | number;
}

export interface ControlLink {
  requirementId: string;
  controlId: string;
}

/**
 * Liens contrôle ↔ exigence pour toutes les exigences d'un référentiel.
 * Croisé côté UI avec listControls (qui porte frameworkCodes par contrôle),
 * il alimente le « fil » de mutualisation et les badges par ligne d'exigence.
 */
export async function listControlLinks(
  tx: TenantTx,
  frameworkId: string,
): Promise<ControlLink[]> {
  const rows = await tx.execute(sql`
    SELECT cr.requirement_id, cr.control_id
    FROM control_requirements cr
    JOIN requirements r ON r.id = cr.requirement_id
    WHERE r.framework_id = ${frameworkId}
  `);
  return (rows as unknown as { requirement_id: string; control_id: string }[]).map((r) => ({
    requirementId: r.requirement_id,
    controlId: r.control_id,
  }));
}

export interface ControlSummary {
  id: string;
  title: string;
  status: string;
  mappedRequirementCount: number;
  frameworkCodes: string[];
  mutualized: boolean;
}

/** Contrôles internes du tenant avec l'état de mutualisation (P1). */
export async function listControls(tx: TenantTx): Promise<ControlSummary[]> {
  const rows = await tx.execute(sql`
    SELECT
      c.id, c.title, c.status,
      count(DISTINCT cr.requirement_id) AS mapped_requirement_count,
      coalesce(
        array_agg(DISTINCT f.code) FILTER (WHERE f.code IS NOT NULL),
        '{}'
      ) AS framework_codes
    FROM controls c
    LEFT JOIN control_requirements cr ON cr.control_id = c.id
    LEFT JOIN requirements r ON r.id = cr.requirement_id
    LEFT JOIN frameworks f ON f.id = r.framework_id
    GROUP BY c.id, c.title, c.status
    ORDER BY c.title
  `);
  return (rows as unknown as RawControl[]).map((r) => {
    const frameworkCodes = [...r.framework_codes].sort();
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      mappedRequirementCount: Number(r.mapped_requirement_count),
      frameworkCodes,
      mutualized: frameworkCodes.length >= 2,
    };
  });
}

interface RawControl {
  id: string;
  title: string;
  status: string;
  mapped_requirement_count: string | number;
  framework_codes: string[];
}

export interface CreateControlInput {
  tenantId: string;
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
}

/** Crée un contrôle interne. tenantId doit être celui du contexte (RLS WITH CHECK). */
export async function createControl(tx: TenantTx, input: CreateControlInput): Promise<string> {
  const [row] = await tx
    .insert(schema.controls)
    .values({
      tenantId: input.tenantId,
      title: input.title,
      description: input.description ?? null,
      ownerUserId: input.ownerUserId ?? null,
    })
    .returning({ id: schema.controls.id });
  return row!.id;
}

/** Mappe un contrôle sur une exigence (idempotent). */
export async function mapControlToRequirement(
  tx: TenantTx,
  tenantId: string,
  controlId: string,
  requirementId: string,
): Promise<void> {
  await tx
    .insert(schema.controlRequirements)
    .values({ tenantId, controlId, requirementId })
    .onConflictDoNothing();
}

/** Retire un mapping contrôle ↔ exigence. */
export async function unmapControlFromRequirement(
  tx: TenantTx,
  controlId: string,
  requirementId: string,
): Promise<void> {
  await tx
    .delete(schema.controlRequirements)
    .where(
      and(
        eq(schema.controlRequirements.controlId, controlId),
        eq(schema.controlRequirements.requirementId, requirementId),
      ),
    );
}

/**
 * Impact de la suppression d'un contrôle (RM §5.2). Récupère les exigences
 * couvertes et, pour chacune, le nombre d'AUTRES contrôles la couvrant,
 * puis délègue la décision à la règle pure de @toron/core.
 */
export async function getControlDeleteImpact(
  tx: TenantTx,
  controlId: string,
): Promise<ControlDeleteImpact> {
  const rows = await tx.execute(sql`
    SELECT
      f.id AS framework_id, f.code AS framework_code, f.name AS framework_name,
      r.id AS requirement_id, r.ref_id AS requirement_ref, r.title_internal AS requirement_title,
      (
        SELECT count(*) FROM control_requirements cr2
        WHERE cr2.requirement_id = r.id AND cr2.control_id <> ${controlId}
      ) AS other_controls_count
    FROM control_requirements cr
    JOIN requirements r ON r.id = cr.requirement_id
    JOIN frameworks f ON f.id = r.framework_id
    WHERE cr.control_id = ${controlId}
  `);
  const covered: CoveredRequirement[] = (rows as unknown as RawCovered[]).map((r) => ({
    frameworkId: r.framework_id,
    frameworkCode: r.framework_code,
    frameworkName: r.framework_name,
    requirementId: r.requirement_id,
    requirementRef: r.requirement_ref,
    requirementTitle: r.requirement_title,
    otherControlsCount: Number(r.other_controls_count),
  }));
  return controlDeleteImpact(covered);
}

interface RawCovered {
  framework_id: string;
  framework_code: string;
  framework_name: string;
  requirement_id: string;
  requirement_ref: string;
  requirement_title: string;
  other_controls_count: string | number;
}

/**
 * Supprime un contrôle (ses mappings partent en cascade). Renvoie le
 * nombre de lignes réellement supprimées : 0 si l'id est inconnu ou
 * appartient à un autre tenant (filtré par la RLS) — l'appelant distingue
 * ainsi un vrai retrait d'un no-op silencieux.
 */
export async function deleteControl(tx: TenantTx, controlId: string): Promise<number> {
  const deleted = await tx
    .delete(schema.controls)
    .where(eq(schema.controls.id, controlId))
    .returning({ id: schema.controls.id });
  return deleted.length;
}

export interface CreateCustomFrameworkInput {
  tenantId: string;
  code: string;
  version: string;
  name: string;
}

/** Crée un référentiel custom (exigences internes/groupe) du tenant. */
export async function createCustomFramework(
  tx: TenantTx,
  input: CreateCustomFrameworkInput,
): Promise<string> {
  const [row] = await tx
    .insert(schema.frameworks)
    .values({
      tenantId: input.tenantId,
      code: input.code,
      version: input.version,
      name: input.name,
      source: 'custom',
    })
    .returning({ id: schema.frameworks.id });
  return row!.id;
}

export interface AddCustomRequirementInput {
  tenantId: string;
  frameworkId: string;
  ref: string;
  title: string;
  guidance?: string | null;
  parentId?: string | null;
  sortOrder?: number;
}

/** Ajoute une exigence à un référentiel custom. */
export async function addCustomRequirement(
  tx: TenantTx,
  input: AddCustomRequirementInput,
): Promise<string> {
  const [row] = await tx
    .insert(schema.requirements)
    .values({
      tenantId: input.tenantId,
      frameworkId: input.frameworkId,
      refId: input.ref,
      titleInternal: input.title,
      guidanceInternal: input.guidance ?? null,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning({ id: schema.requirements.id });
  return row!.id;
}
