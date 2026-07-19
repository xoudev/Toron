import {
  acceptanceState,
  defaultRiskScale,
  riskBand,
  type AcceptanceState,
  type RiskBand,
  type RiskScale,
  type RiskTreatment,
} from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès du moteur de risques (module 5.4, registre manuel) ───
// Opère sur une TenantTx (RLS active). Les bandes de risque et l'état
// d'acceptation sont calculés par @toron/core à partir de l'échelle active
// du tenant ; l'historique conserve les bandes figées au moment du rating.

export interface StoredScale {
  id: string;
  version: number;
  scale: RiskScale;
}

interface RawScale {
  id: string;
  version: number | string;
  size: number | string;
  g_labels: unknown;
  v_labels: unknown;
  bands: unknown;
}

/** Échelle active du tenant (version la plus récente), ou null si aucune. */
export async function getActiveScale(tx: TenantTx): Promise<StoredScale | null> {
  const rows = await tx.execute(sql`
    SELECT id, version, size, g_labels, v_labels, bands
    FROM risk_scales
    ORDER BY version DESC
    LIMIT 1
  `);
  const list = rows as unknown as RawScale[];
  if (list.length === 0) return null;
  const r = list[0]!;
  // Selon le chemin du driver, jsonb revient parsé (objet) ou en texte brut :
  // on normalise pour indexer la matrice de façon fiable.
  const parse = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));
  return {
    id: r.id,
    version: Number(r.version),
    scale: {
      size: Number(r.size),
      gLabels: parse<string[]>(r.g_labels),
      vLabels: parse<string[]>(r.v_labels),
      bands: parse<RiskBand[][]>(r.bands),
    },
  };
}

/**
 * Garantit une échelle active pour le tenant : insère l'échelle 4×4 par défaut
 * (version 1) si aucune n'existe. Idempotent. Renvoie l'échelle active.
 */
export async function ensureDefaultScale(tx: TenantTx, tenantId: string): Promise<StoredScale> {
  const existing = await getActiveScale(tx);
  if (existing) return existing;
  const def = defaultRiskScale();
  const [row] = await tx
    .insert(schema.riskScales)
    .values({
      tenantId,
      version: 1,
      size: def.size,
      gLabels: def.gLabels,
      vLabels: def.vLabels,
      bands: def.bands,
    })
    .returning({ id: schema.riskScales.id });
  return { id: row!.id, version: 1, scale: def };
}

function bandOrThrow(g: number, v: number, scale: RiskScale): RiskBand {
  const band = riskBand(g, v, scale);
  if (band === null) {
    throw new Error(
      `Cotation (G=${g}, V=${v}) hors de l'échelle de risque active (taille ${scale.size}).`,
    );
  }
  return band;
}

export interface CreateRiskInput {
  tenantId: string;
  scopeId: string;
  title: string;
  businessValue?: string | null;
  scenario?: string | null;
  grossG: number;
  grossV: number;
  netG: number;
  netV: number;
  treatment?: RiskTreatment;
  residualTarget?: RiskBand | null;
  ownerUserId?: string | null;
  nextReview?: string | null;
  ratedBy: string;
  /** Provenance : 'manual' (saisie directe) ou 'ebios' (généré depuis un atelier). */
  source?: 'manual' | 'ebios';
}

/**
 * Crée un risque et pose le premier instantané d'historique. Garantit une
 * échelle active au préalable. Renvoie l'id du risque.
 */
export async function createRisk(tx: TenantTx, input: CreateRiskInput): Promise<string> {
  const { scale, version } = await ensureDefaultScale(tx, input.tenantId);
  const grossBand = bandOrThrow(input.grossG, input.grossV, scale);
  const netBand = bandOrThrow(input.netG, input.netV, scale);

  const [row] = await tx
    .insert(schema.risks)
    .values({
      tenantId: input.tenantId,
      scopeId: input.scopeId,
      title: input.title,
      businessValue: input.businessValue ?? null,
      scenario: input.scenario ?? null,
      grossG: input.grossG,
      grossV: input.grossV,
      netG: input.netG,
      netV: input.netV,
      treatment: input.treatment ?? 'reduire',
      residualTarget: input.residualTarget ?? null,
      ownerUserId: input.ownerUserId ?? null,
      nextReview: input.nextReview ?? null,
      source: input.source ?? 'manual',
    })
    .returning({ id: schema.risks.id });
  const riskId = row!.id;

  await tx.insert(schema.riskHistory).values({
    tenantId: input.tenantId,
    riskId,
    grossG: input.grossG,
    grossV: input.grossV,
    grossBand,
    netG: input.netG,
    netV: input.netV,
    netBand,
    scaleVersion: version,
    ratedBy: input.ratedBy,
  });
  return riskId;
}

export interface UpdateRiskRatingInput {
  riskId: string;
  tenantId: string;
  grossG: number;
  grossV: number;
  netG: number;
  netV: number;
  ratedBy: string;
}

/**
 * Met à jour la cotation d'un risque et appose un instantané d'historique
 * (bandes calculées avec l'échelle active, version figée). Renvoie le nombre
 * de risques mis à jour (0 si l'id n'existe pas dans le tenant).
 */
export async function updateRiskRating(tx: TenantTx, input: UpdateRiskRatingInput): Promise<number> {
  const active = await getActiveScale(tx);
  const scale = active?.scale ?? defaultRiskScale();
  const version = active?.version ?? 0;
  const grossBand = bandOrThrow(input.grossG, input.grossV, scale);
  const netBand = bandOrThrow(input.netG, input.netV, scale);

  const updated = await tx
    .update(schema.risks)
    .set({
      grossG: input.grossG,
      grossV: input.grossV,
      netG: input.netG,
      netV: input.netV,
    })
    .where(eq(schema.risks.id, input.riskId))
    .returning({ id: schema.risks.id });
  if (updated.length === 0) return 0;

  await tx.insert(schema.riskHistory).values({
    tenantId: input.tenantId,
    riskId: input.riskId,
    grossG: input.grossG,
    grossV: input.grossV,
    grossBand,
    netG: input.netG,
    netV: input.netV,
    netBand,
    scaleVersion: version,
    ratedBy: input.ratedBy,
  });
  return 1;
}

export interface UpdateRiskDetailsInput {
  riskId: string;
  title?: string;
  businessValue?: string | null;
  scenario?: string | null;
  treatment?: RiskTreatment;
  residualTarget?: RiskBand | null;
  ownerUserId?: string | null;
  nextReview?: string | null;
}

/** Met à jour les attributs non cotés d'un risque. Renvoie le nombre de lignes. */
export async function updateRiskDetails(
  tx: TenantTx,
  input: UpdateRiskDetailsInput,
): Promise<number> {
  const set: Partial<typeof schema.risks.$inferInsert> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.businessValue !== undefined) set.businessValue = input.businessValue;
  if (input.scenario !== undefined) set.scenario = input.scenario;
  if (input.treatment !== undefined) set.treatment = input.treatment;
  if (input.residualTarget !== undefined) set.residualTarget = input.residualTarget;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.nextReview !== undefined) set.nextReview = input.nextReview;
  if (Object.keys(set).length === 0) return 0;

  const updated = await tx
    .update(schema.risks)
    .set(set)
    .where(eq(schema.risks.id, input.riskId))
    .returning({ id: schema.risks.id });
  return updated.length;
}

export interface RiskSummary {
  id: string;
  scopeId: string;
  scopeName: string;
  title: string;
  scenario: string | null;
  businessValue: string | null;
  treatment: RiskTreatment;
  grossG: number;
  grossV: number;
  grossBand: RiskBand | null;
  netG: number;
  netV: number;
  netBand: RiskBand | null;
  residualTarget: RiskBand | null;
  ownerUserId: string | null;
  ownerName: string | null;
  nextReview: string | null;
  controlCount: number;
  acceptanceState: AcceptanceState;
  acceptedByName: string | null;
  acceptedAt: Date | null;
  acceptanceExpiresAt: string | null;
}

interface RawRisk {
  id: string;
  scope_id: string;
  scope_name: string;
  title: string;
  scenario: string | null;
  business_value: string | null;
  treatment: RiskTreatment;
  gross_g: number | string;
  gross_v: number | string;
  net_g: number | string;
  net_v: number | string;
  residual_target: RiskBand | null;
  owner_user_id: string | null;
  owner_name: string | null;
  next_review: string | null;
  control_count: number | string;
  accepted_by_name: string | null;
  accepted_at: string | null; // timestamptz brut (chaîne via tx.execute)
  acceptance_expires_at: string | null;
}

/**
 * Liste les risques du tenant (optionnellement d'un périmètre), avec la bande
 * de risque courante (échelle active) et l'état d'acceptation calculés par le
 * cœur métier. Triée par gravité nette décroissante (les pires d'abord).
 */
export async function listRisks(tx: TenantTx, scopeId?: string): Promise<RiskSummary[]> {
  const active = await getActiveScale(tx);
  const scale = active?.scale ?? defaultRiskScale();
  const now = new Date();

  const rows = await tx.execute(sql`
    SELECT
      r.id, r.scope_id, s.name AS scope_name, r.title, r.scenario, r.business_value, r.treatment,
      r.gross_g, r.gross_v, r.net_g, r.net_v, r.residual_target,
      r.owner_user_id, o.name AS owner_name, r.next_review::text AS next_review,
      (SELECT count(*) FROM risk_controls rc WHERE rc.risk_id = r.id) AS control_count,
      acc.accepted_by_name, acc.accepted_at, acc.acceptance_expires_at
    FROM risks r
    JOIN scopes s ON s.id = r.scope_id
    LEFT JOIN users o ON o.id = r.owner_user_id
    LEFT JOIN LATERAL (
      SELECT ua.name AS accepted_by_name, ra.accepted_at,
             ra.expires_at::text AS acceptance_expires_at
      FROM risk_acceptances ra
      JOIN users ua ON ua.id = ra.accepted_by_user
      WHERE ra.risk_id = r.id
      ORDER BY ra.accepted_at DESC
      LIMIT 1
    ) acc ON true
    ${scopeId ? sql`WHERE r.scope_id = ${scopeId}` : sql``}
    ORDER BY (r.net_g * r.net_v) DESC, r.created_at DESC
  `);

  return (rows as unknown as RawRisk[]).map((r) => {
    const netG = Number(r.net_g);
    const netV = Number(r.net_v);
    const grossG = Number(r.gross_g);
    const grossV = Number(r.gross_v);
    const acceptedAt = r.accepted_at ? new Date(r.accepted_at) : null;
    const state = acceptanceState(
      {
        treatment: r.treatment,
        acceptance: acceptedAt
          ? {
              acceptedAt,
              expiresAt: r.acceptance_expires_at ? new Date(r.acceptance_expires_at) : null,
            }
          : null,
      },
      now,
    );
    return {
      id: r.id,
      scopeId: r.scope_id,
      scopeName: r.scope_name,
      title: r.title,
      scenario: r.scenario,
      businessValue: r.business_value,
      treatment: r.treatment,
      grossG,
      grossV,
      grossBand: riskBand(grossG, grossV, scale),
      netG,
      netV,
      netBand: riskBand(netG, netV, scale),
      residualTarget: r.residual_target,
      ownerUserId: r.owner_user_id,
      ownerName: r.owner_name,
      nextReview: r.next_review,
      controlCount: Number(r.control_count),
      acceptanceState: state,
      acceptedByName: r.accepted_by_name,
      acceptedAt,
      acceptanceExpiresAt: r.acceptance_expires_at,
    };
  });
}

export interface AcceptRiskInput {
  tenantId: string;
  riskId: string;
  acceptedByUser: string;
  rationale: string;
  expiresAt?: string | null;
}

/** Enregistre une acceptation formelle signée (append-only). Renvoie son id. */
export async function acceptRisk(tx: TenantTx, input: AcceptRiskInput): Promise<string> {
  const [row] = await tx
    .insert(schema.riskAcceptances)
    .values({
      tenantId: input.tenantId,
      riskId: input.riskId,
      acceptedByUser: input.acceptedByUser,
      rationale: input.rationale,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: schema.riskAcceptances.id });
  return row!.id;
}

/** Rattache un contrôle atténuant à un risque (idempotent). */
export async function linkRiskControl(
  tx: TenantTx,
  input: { tenantId: string; riskId: string; controlId: string },
): Promise<void> {
  await tx
    .insert(schema.riskControls)
    .values({ tenantId: input.tenantId, riskId: input.riskId, controlId: input.controlId })
    .onConflictDoNothing();
}

/** Identifiants des contrôles atténuants rattachés à un risque. */
export async function listRiskControlIds(tx: TenantTx, riskId: string): Promise<string[]> {
  const rows = await tx.execute(sql`
    SELECT control_id FROM risk_controls WHERE risk_id = ${riskId}
  `);
  return (rows as unknown as { control_id: string }[]).map((r) => r.control_id);
}

/** Détache un contrôle d'un risque. Renvoie le nombre de liens supprimés. */
export async function unlinkRiskControl(
  tx: TenantTx,
  input: { riskId: string; controlId: string },
): Promise<number> {
  const deleted = await tx
    .delete(schema.riskControls)
    .where(
      and(
        eq(schema.riskControls.riskId, input.riskId),
        eq(schema.riskControls.controlId, input.controlId),
      ),
    )
    .returning({ riskId: schema.riskControls.riskId });
  return deleted.length;
}

export interface RiskHistoryRow {
  grossG: number;
  grossV: number;
  grossBand: RiskBand;
  netG: number;
  netV: number;
  netBand: RiskBand;
  scaleVersion: number;
  ratedByName: string | null;
  ratedAt: Date;
}

interface RawHistory {
  gross_g: number | string;
  gross_v: number | string;
  gross_band: RiskBand;
  net_g: number | string;
  net_v: number | string;
  net_band: RiskBand;
  scale_version: number | string;
  rated_by_name: string | null;
  rated_at: string; // timestamptz brut (chaîne via tx.execute)
}

/** Historique des cotations d'un risque (le plus récent d'abord). */
export async function listRiskHistory(tx: TenantTx, riskId: string): Promise<RiskHistoryRow[]> {
  const rows = await tx.execute(sql`
    SELECT h.gross_g, h.gross_v, h.gross_band, h.net_g, h.net_v, h.net_band,
           h.scale_version, u.name AS rated_by_name, h.rated_at
    FROM risk_history h
    LEFT JOIN users u ON u.id = h.rated_by
    WHERE h.risk_id = ${riskId}
    ORDER BY h.rated_at DESC
  `);
  return (rows as unknown as RawHistory[]).map((r) => ({
    grossG: Number(r.gross_g),
    grossV: Number(r.gross_v),
    grossBand: r.gross_band,
    netG: Number(r.net_g),
    netV: Number(r.net_v),
    netBand: r.net_band,
    scaleVersion: Number(r.scale_version),
    ratedByName: r.rated_by_name,
    ratedAt: new Date(r.rated_at),
  }));
}
