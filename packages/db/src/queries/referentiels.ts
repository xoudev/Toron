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
  mappedControlCount: number;
}

/** Catalogue des référentiels visibles du tenant (builtin + custom). */
export async function listFrameworks(tx: TenantTx): Promise<FrameworkSummary[]> {
  const rows = await tx.execute(sql`
    SELECT
      f.id, f.code, f.version, f.name, f.source,
      (f.tenant_id IS NULL) AS is_builtin,
      count(DISTINCT r.id) AS requirement_count,
      count(DISTINCT cr.control_id) AS mapped_control_count
    FROM frameworks f
    LEFT JOIN requirements r ON r.framework_id = f.id
    LEFT JOIN control_requirements cr ON cr.requirement_id = r.id
    GROUP BY f.id, f.code, f.version, f.name, f.source, is_builtin
    ORDER BY is_builtin DESC, f.code
  `);
  return (rows as unknown as RawFramework[]).map((r) => ({
    id: r.id,
    code: r.code,
    version: r.version,
    name: r.name,
    source: r.source,
    isBuiltin: r.is_builtin,
    requirementCount: Number(r.requirement_count),
    mappedControlCount: Number(r.mapped_control_count),
  }));
}

interface RawFramework {
  id: string;
  code: string;
  version: string;
  name: string;
  source: 'builtin' | 'custom';
  is_builtin: boolean;
  requirement_count: string | number;
  mapped_control_count: string | number;
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

/** Supprime un contrôle (ses mappings partent en cascade). */
export async function deleteControl(tx: TenantTx, controlId: string): Promise<void> {
  await tx.delete(schema.controls).where(eq(schema.controls.id, controlId));
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
