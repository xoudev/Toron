import {
  reviewOverdue,
  type DocumentType,
  type DocumentVersionStatus,
} from '@toron/core';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès de la gestion documentaire (module 5.6, MVP light) ──
// RLS active. RM §5.6 : une version publiée est immuable (garantie par un
// trigger en base) — on n'expose donc que « ajouter une version » et
// « publier un brouillon ».

export interface CreateDocumentInput {
  tenantId: string;
  type: DocumentType;
  title: string;
  scopeId?: string | null;
  ownerUserId?: string | null;
  reviewDue?: string | null;
}

export async function createDocument(tx: TenantTx, input: CreateDocumentInput): Promise<string> {
  const [row] = await tx
    .insert(schema.documents)
    .values({
      tenantId: input.tenantId,
      type: input.type,
      title: input.title,
      scopeId: input.scopeId ?? null,
      ownerUserId: input.ownerUserId ?? null,
      reviewDue: input.reviewDue ?? null,
    })
    .returning({ id: schema.documents.id });
  return row!.id;
}

export interface AddVersionInput {
  tenantId: string;
  documentId: string;
  semver: string;
  fileName?: string | null;
  content?: Buffer | null;
  createdBy: string;
}

/** Ajoute une version en brouillon. Renvoie son id. */
export async function addVersion(tx: TenantTx, input: AddVersionInput): Promise<string> {
  const [row] = await tx
    .insert(schema.documentVersions)
    .values({
      tenantId: input.tenantId,
      documentId: input.documentId,
      semver: input.semver,
      fileName: input.fileName ?? null,
      content: input.content ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: schema.documentVersions.id });
  return row!.id;
}

/**
 * Publie une version en brouillon (brouillon → publié). Ne touche jamais une
 * version déjà publiée (le trigger `document_versions_freeze` la protège).
 * Renvoie le nombre de lignes affectées (0 si l'id n'est pas un brouillon).
 */
export async function publishVersion(tx: TenantTx, versionId: string): Promise<number> {
  const updated = await tx
    .update(schema.documentVersions)
    .set({ status: 'publie', publishedAt: new Date() })
    .where(
      and(
        eq(schema.documentVersions.id, versionId),
        eq(schema.documentVersions.status, 'brouillon'),
      ),
    )
    .returning({ id: schema.documentVersions.id });
  return updated.length;
}

export interface DocumentSummary {
  id: string;
  type: DocumentType;
  title: string;
  scopeName: string | null;
  ownerName: string | null;
  reviewDue: string | null;
  reviewOverdue: boolean;
  versionCount: number;
  latestVersionId: string | null;
  latestSemver: string | null;
  latestStatus: DocumentVersionStatus | null;
  requirementCount: number;
}

interface RawDocument {
  id: string;
  type: DocumentType;
  title: string;
  scope_name: string | null;
  owner_name: string | null;
  review_due: string | null;
  version_count: number | string;
  latest_version_id: string | null;
  latest_semver: string | null;
  latest_status: DocumentVersionStatus | null;
  requirement_count: number | string;
}

/** Liste les documents du tenant avec leur dernière version et l'alerte de revue. */
export async function listDocuments(tx: TenantTx): Promise<DocumentSummary[]> {
  const rows = await tx.execute(sql`
    SELECT
      d.id, d.type, d.title, s.name AS scope_name, o.name AS owner_name,
      d.review_due::text AS review_due,
      (SELECT count(*) FROM document_versions v WHERE v.document_id = d.id) AS version_count,
      (SELECT count(*) FROM document_requirements dr WHERE dr.document_id = d.id) AS requirement_count,
      lv.id AS latest_version_id, lv.semver AS latest_semver, lv.status AS latest_status
    FROM documents d
    LEFT JOIN scopes s ON s.id = d.scope_id
    LEFT JOIN users o ON o.id = d.owner_user_id
    LEFT JOIN LATERAL (
      SELECT id, semver, status FROM document_versions v
      WHERE v.document_id = d.id ORDER BY v.created_at DESC LIMIT 1
    ) lv ON true
    ORDER BY d.type, d.title
  `);
  const now = new Date();
  return (rows as unknown as RawDocument[]).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    scopeName: r.scope_name,
    ownerName: r.owner_name,
    reviewDue: r.review_due,
    reviewOverdue: reviewOverdue(r.review_due ? new Date(r.review_due) : null, now),
    versionCount: Number(r.version_count),
    latestVersionId: r.latest_version_id,
    latestSemver: r.latest_semver,
    latestStatus: r.latest_status,
    requirementCount: Number(r.requirement_count),
  }));
}

export interface DocumentVersionRow {
  id: string;
  semver: string;
  status: DocumentVersionStatus;
  fileName: string | null;
  hasContent: boolean;
  createdByName: string | null;
  createdAt: Date;
}

/** Versions d'un document (la plus récente d'abord). */
export async function listVersions(tx: TenantTx, documentId: string): Promise<DocumentVersionRow[]> {
  const rows = await tx.execute(sql`
    SELECT v.id, v.semver, v.status, v.file_name, (v.content IS NOT NULL) AS has_content,
           u.name AS created_by_name, v.created_at::text AS created_at
    FROM document_versions v LEFT JOIN users u ON u.id = v.created_by
    WHERE v.document_id = ${documentId}
    ORDER BY v.created_at DESC
  `);
  return (
    rows as unknown as {
      id: string;
      semver: string;
      status: DocumentVersionStatus;
      file_name: string | null;
      has_content: boolean;
      created_by_name: string | null;
      created_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    semver: r.semver,
    status: r.status,
    fileName: r.file_name,
    hasContent: r.has_content,
    createdByName: r.created_by_name,
    createdAt: new Date(r.created_at),
  }));
}

/** Dernier semver d'un document (pour proposer le prochain), ou null. */
export async function latestSemver(tx: TenantTx, documentId: string): Promise<string | null> {
  const rows = await tx.execute(sql`
    SELECT semver FROM document_versions WHERE document_id = ${documentId}
    ORDER BY created_at DESC LIMIT 1
  `);
  const list = rows as unknown as { semver: string }[];
  return list[0]?.semver ?? null;
}

export interface VersionContent {
  content: Buffer;
  fileName: string | null;
}

/** Contenu binaire d'une version (téléchargement), scopé au tenant. */
export async function getVersionContent(
  tx: TenantTx,
  versionId: string,
): Promise<VersionContent | null> {
  const [row] = await tx
    .select({ content: schema.documentVersions.content, fileName: schema.documentVersions.fileName })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.id, versionId));
  if (!row || !row.content) return null;
  return { content: row.content, fileName: row.fileName };
}

// ── Exigences couvertes (RM §5.6 : apparaissent dans la SoA) ────────────
export async function linkRequirement(
  tx: TenantTx,
  input: { tenantId: string; documentId: string; requirementId: string },
): Promise<void> {
  await tx
    .insert(schema.documentRequirements)
    .values({
      tenantId: input.tenantId,
      documentId: input.documentId,
      requirementId: input.requirementId,
    })
    .onConflictDoNothing();
}

export async function unlinkRequirement(
  tx: TenantTx,
  input: { documentId: string; requirementId: string },
): Promise<number> {
  const deleted = await tx
    .delete(schema.documentRequirements)
    .where(
      and(
        eq(schema.documentRequirements.documentId, input.documentId),
        eq(schema.documentRequirements.requirementId, input.requirementId),
      ),
    )
    .returning({ documentId: schema.documentRequirements.documentId });
  return deleted.length;
}

export async function listDocumentRequirementIds(
  tx: TenantTx,
  documentId: string,
): Promise<string[]> {
  const rows = await tx.execute(sql`
    SELECT requirement_id FROM document_requirements WHERE document_id = ${documentId}
  `);
  return (rows as unknown as { requirement_id: string }[]).map((r) => r.requirement_id);
}

export interface CoveringDocument {
  documentId: string;
  title: string;
  type: DocumentType;
  latestStatus: DocumentVersionStatus | null;
}

/** Documents couvrant une exigence (alimente la SoA, RM §5.6). */
export async function listDocumentsCoveringRequirement(
  tx: TenantTx,
  requirementId: string,
): Promise<CoveringDocument[]> {
  const rows = await tx.execute(sql`
    SELECT d.id AS document_id, d.title, d.type,
      (SELECT status FROM document_versions v WHERE v.document_id = d.id
       ORDER BY v.created_at DESC LIMIT 1) AS latest_status
    FROM document_requirements dr
    JOIN documents d ON d.id = dr.document_id
    WHERE dr.requirement_id = ${requirementId}
    ORDER BY d.title
  `);
  return (
    rows as unknown as {
      document_id: string;
      title: string;
      type: DocumentType;
      latest_status: DocumentVersionStatus | null;
    }[]
  ).map((r) => ({
    documentId: r.document_id,
    title: r.title,
    type: r.type,
    latestStatus: r.latest_status,
  }));
}
