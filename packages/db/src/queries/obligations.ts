import type {
  Nis2Registration,
  Nis2Status,
  ObligationRegime,
  ObligationStatus,
  ObligationTemplate,
} from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Registre des obligations & qualification NIS 2 (module 6.4) ────────

export interface EntityNis2 {
  id: string;
  name: string;
  siren: string | null;
  sector: string | null;
  employees: number | null;
  turnoverMeur: number | null;
  balanceSheetMeur: number | null;
  override: Nis2Status | null;
  overrideReason: string | null;
  registration: Nis2Registration;
  registeredOn: string | null;
  reference: string | null;
}

interface RawEntity {
  id: string;
  name: string;
  siren: string | null;
  nis2_sector: string | null;
  employee_count: number | null;
  turnover_meur: string | null;
  balance_sheet_meur: string | null;
  nis2_override: Nis2Status | null;
  nis2_override_reason: string | null;
  nis2_registration: Nis2Registration;
  nis2_registered_on: string | null;
  nis2_reference: string | null;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

export async function listEntitiesNis2(tx: TenantTx): Promise<EntityNis2[]> {
  const rows = (await tx.execute(sql`
    SELECT id, name, siren, nis2_sector, employee_count, turnover_meur::text, balance_sheet_meur::text,
           nis2_override, nis2_override_reason, nis2_registration, nis2_registered_on::text, nis2_reference
    FROM legal_entities ORDER BY created_at, name
  `)) as unknown as RawEntity[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    siren: r.siren,
    sector: r.nis2_sector,
    employees: r.employee_count,
    turnoverMeur: num(r.turnover_meur),
    balanceSheetMeur: num(r.balance_sheet_meur),
    override: r.nis2_override,
    overrideReason: r.nis2_override_reason,
    registration: r.nis2_registration,
    registeredOn: r.nis2_registered_on,
    reference: r.nis2_reference,
  }));
}

export interface UpdateEntityNis2Input {
  entityId: string;
  sector: string | null;
  employees: number | null;
  turnoverMeur: number | null;
  balanceSheetMeur: number | null;
  override: Nis2Status | null;
  overrideReason: string | null;
  registration: Nis2Registration;
  registeredOn: string | null;
  reference: string | null;
}

export async function updateEntityNis2(tx: TenantTx, i: UpdateEntityNis2Input): Promise<number> {
  const updated = await tx
    .update(schema.legalEntities)
    .set({
      nis2Sector: i.sector,
      employeeCount: i.employees,
      turnoverMeur: i.turnoverMeur === null ? null : String(i.turnoverMeur),
      balanceSheetMeur: i.balanceSheetMeur === null ? null : String(i.balanceSheetMeur),
      nis2Override: i.override,
      nis2OverrideReason: i.override ? i.overrideReason : null,
      nis2Registration: i.registration,
      nis2RegisteredOn: i.registeredOn,
      nis2Reference: i.reference,
    })
    .where(eq(schema.legalEntities.id, i.entityId))
    .returning({ id: schema.legalEntities.id });
  return updated.length;
}

export interface ObligationRow {
  id: string;
  entityId: string | null;
  entityName: string | null;
  regime: ObligationRegime;
  catalogKey: string | null;
  title: string;
  source: string | null;
  description: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  status: ObligationStatus;
  justification: string | null;
  dueDate: string | null;
}

interface RawObligation {
  id: string;
  entity_id: string | null;
  entity_name: string | null;
  regime: ObligationRegime;
  catalog_key: string | null;
  title: string;
  source: string | null;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  status: ObligationStatus;
  justification: string | null;
  due_date: string | null;
}

/** Registre trié par régime, puis par échéance (les plus proches d'abord). */
export async function listObligations(tx: TenantTx): Promise<ObligationRow[]> {
  const rows = (await tx.execute(sql`
    SELECT o.id, o.entity_id, e.name AS entity_name, o.regime, o.catalog_key, o.title, o.source, o.description,
           o.owner_user_id, u.name AS owner_name, o.status, o.justification, o.due_date::text AS due_date
    FROM obligations o
    LEFT JOIN legal_entities e ON e.id = o.entity_id
    LEFT JOIN users u ON u.id = o.owner_user_id
    ORDER BY array_position(ARRAY['nis2','rgpd','sectoriel','contractuel','autre'], o.regime),
             o.due_date NULLS LAST, o.created_at
  `)) as unknown as RawObligation[];
  return rows.map((r) => ({
    id: r.id,
    entityId: r.entity_id,
    entityName: r.entity_name,
    regime: r.regime,
    catalogKey: r.catalog_key,
    title: r.title,
    source: r.source,
    description: r.description,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name,
    status: r.status,
    justification: r.justification,
    dueDate: r.due_date,
  }));
}

export interface ObligationInput {
  entityId: string | null;
  regime: ObligationRegime;
  title: string;
  source: string | null;
  description: string | null;
  ownerUserId: string | null;
  status: ObligationStatus;
  justification: string | null;
  dueDate: string | null;
}

export async function createObligation(tx: TenantTx, tenantId: string, i: ObligationInput): Promise<string> {
  const [row] = await tx
    .insert(schema.obligations)
    .values({ tenantId, ...i })
    .returning({ id: schema.obligations.id });
  return row!.id;
}

export async function updateObligation(tx: TenantTx, obligationId: string, i: ObligationInput): Promise<number> {
  const updated = await tx
    .update(schema.obligations)
    .set(i)
    .where(eq(schema.obligations.id, obligationId))
    .returning({ id: schema.obligations.id });
  return updated.length;
}

export async function deleteObligation(tx: TenantTx, obligationId: string): Promise<{ title: string } | null> {
  const [row] = await tx
    .delete(schema.obligations)
    .where(eq(schema.obligations.id, obligationId))
    .returning({ title: schema.obligations.title });
  return row ?? null;
}

/**
 * Ajoute les obligations suggérées pour une entité ; celles déjà présentes
 * (même clé de catalogue) sont ignorées. Renvoie le nombre d'ajouts.
 */
export async function addCatalogObligations(
  tx: TenantTx,
  input: { tenantId: string; entityId: string | null; ownerUserId: string | null; templates: readonly ObligationTemplate[] },
): Promise<number> {
  let added = 0;
  for (const t of input.templates) {
    const rows = await tx.execute(sql`
      INSERT INTO obligations (tenant_id, entity_id, regime, catalog_key, title, source, owner_user_id)
      VALUES (${input.tenantId}, ${input.entityId}, ${t.regime}, ${t.key}, ${t.title}, ${t.source}, ${input.ownerUserId})
      ON CONFLICT (tenant_id, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), catalog_key)
        WHERE catalog_key IS NOT NULL DO NOTHING
      RETURNING id
    `);
    added += (rows as unknown as unknown[]).length;
  }
  return added;
}
