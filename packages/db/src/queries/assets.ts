import { assetSensitivity, type AssetCategory, type ParsedAssetRow } from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des actifs (module 6.3, MVP minimal) ────────────────
// RLS active. La sensibilité (max DICP) est calculée par @toron/core.

export interface CreateAssetInput {
  tenantId: string;
  name: string;
  category: AssetCategory;
  description?: string | null;
  ownerUserId?: string | null;
  scopeId?: string | null;
  dicpD: number;
  dicpI: number;
  dicpC: number;
  dicpP: number;
}

export async function createAsset(tx: TenantTx, input: CreateAssetInput): Promise<string> {
  const [row] = await tx
    .insert(schema.assets)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      category: input.category,
      description: input.description ?? null,
      ownerUserId: input.ownerUserId ?? null,
      scopeId: input.scopeId ?? null,
      dicpD: input.dicpD,
      dicpI: input.dicpI,
      dicpC: input.dicpC,
      dicpP: input.dicpP,
    })
    .returning({ id: schema.assets.id });
  return row!.id;
}

/** Insère en lot des actifs issus d'un import CSV. Renvoie le nombre créé. */
export async function bulkCreateAssets(
  tx: TenantTx,
  tenantId: string,
  rows: readonly ParsedAssetRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => ({
    tenantId,
    name: r.name,
    category: r.category,
    description: r.description,
    dicpD: r.dicp.d,
    dicpI: r.dicp.i,
    dicpC: r.dicp.c,
    dicpP: r.dicp.p,
  }));
  const inserted = await tx.insert(schema.assets).values(values).returning({ id: schema.assets.id });
  return inserted.length;
}

export interface AssetSummary {
  id: string;
  name: string;
  category: AssetCategory;
  description: string | null;
  ownerName: string | null;
  scopeName: string | null;
  dicp: { d: number; i: number; c: number; p: number };
  sensitivity: number;
  riskCount: number;
}

interface RawAsset {
  id: string;
  name: string;
  category: AssetCategory;
  description: string | null;
  owner_name: string | null;
  scope_name: string | null;
  dicp_d: number | string;
  dicp_i: number | string;
  dicp_c: number | string;
  dicp_p: number | string;
  risk_count: number | string;
}

/** Inventaire des actifs, trié par sensibilité décroissante (les plus sensibles d'abord). */
export async function listAssets(tx: TenantTx): Promise<AssetSummary[]> {
  const rows = await tx.execute(sql`
    SELECT a.id, a.name, a.category, a.description,
           o.name AS owner_name, s.name AS scope_name,
           a.dicp_d, a.dicp_i, a.dicp_c, a.dicp_p,
           (SELECT count(*) FROM asset_risks ar WHERE ar.asset_id = a.id) AS risk_count
    FROM assets a
    LEFT JOIN users o ON o.id = a.owner_user_id
    LEFT JOIN scopes s ON s.id = a.scope_id
    ORDER BY GREATEST(a.dicp_d, a.dicp_i, a.dicp_c, a.dicp_p) DESC, a.name
  `);
  return (rows as unknown as RawAsset[]).map((r) => {
    const dicp = {
      d: Number(r.dicp_d),
      i: Number(r.dicp_i),
      c: Number(r.dicp_c),
      p: Number(r.dicp_p),
    };
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      ownerName: r.owner_name,
      scopeName: r.scope_name,
      dicp,
      sensitivity: assetSensitivity(dicp),
      riskCount: Number(r.risk_count),
    };
  });
}

// ── Lien actif ↔ risque ─────────────────────────────────────────────────
export async function linkAssetRisk(
  tx: TenantTx,
  input: { tenantId: string; assetId: string; riskId: string },
): Promise<void> {
  await tx
    .insert(schema.assetRisks)
    .values({ tenantId: input.tenantId, assetId: input.assetId, riskId: input.riskId })
    .onConflictDoNothing();
}

export async function unlinkAssetRisk(
  tx: TenantTx,
  input: { assetId: string; riskId: string },
): Promise<number> {
  const deleted = await tx
    .delete(schema.assetRisks)
    .where(and(eq(schema.assetRisks.assetId, input.assetId), eq(schema.assetRisks.riskId, input.riskId)))
    .returning({ assetId: schema.assetRisks.assetId });
  return deleted.length;
}

export async function listAssetRiskIds(tx: TenantTx, assetId: string): Promise<string[]> {
  const rows = await tx.execute(sql`SELECT risk_id FROM asset_risks WHERE asset_id = ${assetId}`);
  return (rows as unknown as { risk_id: string }[]).map((r) => r.risk_id);
}
