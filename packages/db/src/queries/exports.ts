import { and, desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../client.ts';
import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des exports scellés (module 5.3c, ADR-6) ────────────

export interface ClaimedExport {
  id: string;
  tenantId: string;
  objectRef: string | null;
  type: string;
}

/**
 * Réclame le prochain export à traiter (worker). Passe par la fonction
 * SECURITY DEFINER claim_next_export : voit les jobs de tous les tenants
 * sans BYPASSRLS, claim atomique. Prend le client brut (pas de withTenant) —
 * le traitement qui suit repasse par withTenant(tenantId).
 */
export async function claimNextExport(db: Db): Promise<ClaimedExport | null> {
  const rows = await db.execute(
    sql`SELECT id, tenant_id, object_ref, type FROM claim_next_export()`,
  );
  const list = rows as unknown as {
    id: string;
    tenant_id: string;
    object_ref: string | null;
    type: string;
  }[];
  if (list.length === 0) return null;
  const r = list[0]!;
  return { id: r.id, tenantId: r.tenant_id, objectRef: r.object_ref, type: r.type };
}

export interface CreateExportInput {
  tenantId: string;
  type: 'soa' | 'pv';
  objectRef: string;
  requestedBy: string;
}

/** Crée un export « en cours » (avant compilation par le worker). */
export async function createExport(tx: TenantTx, input: CreateExportInput): Promise<string> {
  const [row] = await tx
    .insert(schema.exports)
    .values({
      tenantId: input.tenantId,
      type: input.type,
      objectRef: input.objectRef,
      requestedBy: input.requestedBy,
    })
    .returning({ id: schema.exports.id });
  return row!.id;
}

export interface SealExportInput {
  exportId: string;
  pdf: Buffer;
  sha256: string;
  verifySlug: string;
}

/** Scelle un export : PDF, empreinte, slug de vérification (ADR-6). */
export async function sealExport(tx: TenantTx, input: SealExportInput): Promise<number> {
  const updated = await tx
    .update(schema.exports)
    .set({
      status: 'scelle',
      pdf: input.pdf,
      sha256: input.sha256,
      verifySlug: input.verifySlug,
      sealedAt: new Date(),
      error: null,
    })
    .where(eq(schema.exports.id, input.exportId))
    .returning({ id: schema.exports.id });
  return updated.length;
}

/** Marque un export en échec (cause sans PII). */
export async function failExport(tx: TenantTx, exportId: string, error: string): Promise<number> {
  const updated = await tx
    .update(schema.exports)
    .set({ status: 'echec', error })
    .where(eq(schema.exports.id, exportId))
    .returning({ id: schema.exports.id });
  return updated.length;
}

export interface ExportSummary {
  id: string;
  type: string;
  objectRef: string | null;
  status: string;
  sha256: string | null;
  verifySlug: string | null;
  sealedAt: Date | null;
  createdAt: Date;
}

/** Métadonnées d'un export (sans le PDF). */
export async function getExport(tx: TenantTx, exportId: string): Promise<ExportSummary | null> {
  const [row] = await tx
    .select({
      id: schema.exports.id,
      type: schema.exports.type,
      objectRef: schema.exports.objectRef,
      status: schema.exports.status,
      sha256: schema.exports.sha256,
      verifySlug: schema.exports.verifySlug,
      sealedAt: schema.exports.sealedAt,
      createdAt: schema.exports.createdAt,
    })
    .from(schema.exports)
    .where(eq(schema.exports.id, exportId));
  return row ?? null;
}

/** Exports d'un objet source (ex. une campagne), plus récents d'abord. */
export async function listExportsForObject(
  tx: TenantTx,
  objectRef: string,
): Promise<ExportSummary[]> {
  return tx
    .select({
      id: schema.exports.id,
      type: schema.exports.type,
      objectRef: schema.exports.objectRef,
      status: schema.exports.status,
      sha256: schema.exports.sha256,
      verifySlug: schema.exports.verifySlug,
      sealedAt: schema.exports.sealedAt,
      createdAt: schema.exports.createdAt,
    })
    .from(schema.exports)
    .where(eq(schema.exports.objectRef, objectRef))
    .orderBy(desc(schema.exports.createdAt));
}

/** Le PDF scellé d'un export (pour le téléchargement authentifié). */
export async function getExportPdf(
  tx: TenantTx,
  exportId: string,
): Promise<{ pdf: Buffer; sha256: string } | null> {
  const [row] = await tx
    .select({ pdf: schema.exports.pdf, sha256: schema.exports.sha256 })
    .from(schema.exports)
    .where(and(eq(schema.exports.id, exportId), eq(schema.exports.status, 'scelle')));
  if (!row || !row.pdf || !row.sha256) return null;
  return { pdf: row.pdf, sha256: row.sha256 };
}

export interface VerifiedExport {
  type: string;
  sha256: string;
  sealedAt: Date;
}

/**
 * Vérification PUBLIQUE d'un poinçon (ADR-6). Passe par la fonction
 * SECURITY DEFINER verify_export : résout le slug SANS contexte tenant et
 * n'expose que type/empreinte/date — jamais le PDF ni le tenant. Prend le
 * client brut (pas de withTenant) : c'est l'unique accès public légitime.
 */
export async function verifyExport(db: Db, slug: string): Promise<VerifiedExport | null> {
  const rows = await db.execute(
    sql`SELECT type, sha256, sealed_at FROM verify_export(${slug})`,
  );
  // db.execute renvoie les lignes brutes du driver : sealed_at est une chaîne.
  const list = rows as unknown as { type: string; sha256: string; sealed_at: string | Date }[];
  if (list.length === 0) return null;
  const r = list[0]!;
  return { type: r.type, sha256: r.sha256, sealedAt: new Date(r.sealed_at) };
}
