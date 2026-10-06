import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Accusés de lecture des documents ──────────────────────────────────────
// Un document en « lecture obligatoire » est accepté par chaque membre, version
// publiée par version publiée. L'accusé ne se modifie ni ne se supprime.

export async function setAcknowledgementRequired(tx: TenantTx, documentId: string, required: boolean): Promise<number> {
  const rows = await tx.update(schema.documents).set({ acknowledgementRequired: required })
    .where(eq(schema.documents.id, documentId)).returning({ id: schema.documents.id });
  return rows.length;
}

interface PublishedVersion { id: string; semver: string; publishedAt: Date | null }

async function currentPublishedVersion(tx: TenantTx, documentId: string): Promise<PublishedVersion | null> {
  const rows = (await tx.execute(sql`
    SELECT id, semver, published_at::text AS published_at FROM document_versions
    WHERE document_id = ${documentId} AND status = 'publie'
    ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 1
  `)) as unknown as { id: string; semver: string; published_at: string | null }[];
  const r = rows[0];
  return r ? { id: r.id, semver: r.semver, publishedAt: r.published_at ? new Date(r.published_at) : null } : null;
}

export type AcknowledgeResult =
  | { outcome: 'accepte'; versionId: string; semver: string }
  | { outcome: 'deja_accepte'; versionId: string; semver: string }
  | { outcome: 'aucune_version' };

/** Accuse réception de la version publiée courante pour l'utilisateur donné. */
export async function acknowledgeDocument(tx: TenantTx, input: { tenantId: string; documentId: string; userId: string }): Promise<AcknowledgeResult> {
  const version = await currentPublishedVersion(tx, input.documentId);
  if (!version) return { outcome: 'aucune_version' };
  const inserted = await tx.insert(schema.documentAcknowledgements)
    .values({ tenantId: input.tenantId, versionId: version.id, userId: input.userId })
    .onConflictDoNothing()
    .returning({ versionId: schema.documentAcknowledgements.versionId });
  return { outcome: inserted.length > 0 ? 'accepte' : 'deja_accepte', versionId: version.id, semver: version.semver };
}

export interface AcknowledgementMember {
  userId: string;
  name: string;
  acknowledgedAt: Date | null;
}

export interface AcknowledgementStatus {
  required: boolean;
  version: PublishedVersion | null;
  members: AcknowledgementMember[];
}

/** État des accusés sur la version publiée courante, membre par membre. */
export async function getAcknowledgementStatus(tx: TenantTx, documentId: string): Promise<AcknowledgementStatus | null> {
  const [doc] = await tx.select({ required: schema.documents.acknowledgementRequired }).from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!doc) return null;
  const version = await currentPublishedVersion(tx, documentId);
  const members = (await tx.execute(sql`
    SELECT u.id AS user_id, u.name,
      (SELECT a.acknowledged_at::text FROM document_acknowledgements a
        WHERE a.user_id = u.id AND a.version_id = ${version?.id ?? null}::uuid) AS acknowledged_at
    FROM memberships m JOIN users u ON u.id = m.user_id
    ORDER BY u.name
  `)) as unknown as { user_id: string; name: string; acknowledged_at: string | null }[];
  return {
    required: doc.required,
    version,
    members: members.map((m) => ({ userId: m.user_id, name: m.name, acknowledgedAt: m.acknowledged_at ? new Date(m.acknowledged_at) : null })),
  };
}

/** L'utilisateur a-t-il accepté cette version ? */
export async function hasAcknowledged(tx: TenantTx, versionId: string, userId: string): Promise<boolean> {
  const rows = await tx.select({ v: schema.documentAcknowledgements.versionId }).from(schema.documentAcknowledgements)
    .where(and(eq(schema.documentAcknowledgements.versionId, versionId), eq(schema.documentAcknowledgements.userId, userId)));
  return rows.length > 0;
}
