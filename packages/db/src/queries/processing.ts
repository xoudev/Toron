import type { LegalBasis } from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Registre des activités de traitement (RGPD art. 30) ────────────────

export interface ProcessorRef {
  supplierId: string;
  name: string;
  /** Validité du dernier accord de traitement : null = sans échéance ; undefined = aucun accord enregistré. */
  dpaValidUntil: string | null | undefined;
}

export interface ProcessingRow {
  id: string;
  entityId: string | null;
  name: string;
  purpose: string;
  legalBasis: LegalBasis;
  legalBasisDetail: string | null;
  dataSubjects: string[];
  dataCategories: string[];
  sensitiveData: boolean;
  recipients: string | null;
  transfersOutsideEu: boolean;
  transferSafeguards: string | null;
  retention: string | null;
  securityMeasures: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  lastReviewedOn: string | null;
  processors: ProcessorRef[];
}

interface RawProcessing {
  id: string;
  entity_id: string | null;
  name: string;
  purpose: string;
  legal_basis: LegalBasis;
  legal_basis_detail: string | null;
  data_subjects: string[];
  data_categories: string[];
  sensitive_data: boolean;
  recipients: string | null;
  transfers_outside_eu: boolean;
  transfer_safeguards: string | null;
  retention: string | null;
  security_measures: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  last_reviewed_on: string | null;
  processors: unknown;
}

export async function listProcessing(tx: TenantTx): Promise<ProcessingRow[]> {
  const rows = (await tx.execute(sql`
    SELECT p.id, p.entity_id, p.name, p.purpose, p.legal_basis, p.legal_basis_detail, p.data_subjects, p.data_categories,
           p.sensitive_data, p.recipients, p.transfers_outside_eu, p.transfer_safeguards, p.retention, p.security_measures,
           p.owner_user_id, u.name AS owner_name, p.last_reviewed_on::text AS last_reviewed_on,
           coalesce((
             SELECT json_agg(json_build_object(
                      'supplierId', s.id, 'name', s.name,
                      'hasDpa', dpa.id IS NOT NULL, 'dpaValidUntil', dpa.valid_until) ORDER BY s.name)
             FROM processing_processors pp
             JOIN suppliers s ON s.id = pp.supplier_id
             LEFT JOIN LATERAL (
               SELECT t.id, t.valid_until::text AS valid_until FROM supplier_attestations t
               WHERE t.supplier_id = s.id AND t.kind = 'dpa'
               ORDER BY t.valid_until DESC NULLS FIRST LIMIT 1
             ) dpa ON true
             WHERE pp.processing_id = p.id
           ), '[]'::json) AS processors
    FROM processing_activities p
    LEFT JOIN users u ON u.id = p.owner_user_id
    ORDER BY p.name
  `)) as unknown as RawProcessing[];
  return rows.map((r) => {
    const raw = (typeof r.processors === 'string' ? JSON.parse(r.processors) : r.processors) as { supplierId: string; name: string; hasDpa: boolean; dpaValidUntil: string | null }[];
    return {
      id: r.id,
      entityId: r.entity_id,
      name: r.name,
      purpose: r.purpose,
      legalBasis: r.legal_basis,
      legalBasisDetail: r.legal_basis_detail,
      dataSubjects: r.data_subjects,
      dataCategories: r.data_categories,
      sensitiveData: r.sensitive_data,
      recipients: r.recipients,
      transfersOutsideEu: r.transfers_outside_eu,
      transferSafeguards: r.transfer_safeguards,
      retention: r.retention,
      securityMeasures: r.security_measures,
      ownerUserId: r.owner_user_id,
      ownerName: r.owner_name,
      lastReviewedOn: r.last_reviewed_on,
      processors: raw.map((x) => ({ supplierId: x.supplierId, name: x.name, dpaValidUntil: x.hasDpa ? x.dpaValidUntil : undefined })),
    };
  });
}

export interface ProcessingInput {
  entityId: string | null;
  name: string;
  purpose: string;
  legalBasis: LegalBasis;
  legalBasisDetail: string | null;
  dataSubjects: string[];
  dataCategories: string[];
  sensitiveData: boolean;
  recipients: string | null;
  transfersOutsideEu: boolean;
  transferSafeguards: string | null;
  retention: string | null;
  securityMeasures: string | null;
  ownerUserId: string | null;
  lastReviewedOn: string | null;
}

async function setProcessors(tx: TenantTx, tenantId: string, processingId: string, supplierIds: readonly string[]): Promise<void> {
  await tx.delete(schema.processingProcessors).where(eq(schema.processingProcessors.processingId, processingId));
  if (supplierIds.length > 0) {
    await tx.insert(schema.processingProcessors).values([...new Set(supplierIds)].map((supplierId) => ({ tenantId, processingId, supplierId })));
  }
}

export async function createProcessing(tx: TenantTx, tenantId: string, input: ProcessingInput, supplierIds: readonly string[]): Promise<string> {
  const [row] = await tx.insert(schema.processingActivities).values({ ...input, tenantId }).returning({ id: schema.processingActivities.id });
  await setProcessors(tx, tenantId, row!.id, supplierIds);
  return row!.id;
}

export async function updateProcessing(tx: TenantTx, tenantId: string, processingId: string, input: ProcessingInput, supplierIds: readonly string[]): Promise<number> {
  const updated = await tx
    .update(schema.processingActivities)
    .set(input)
    .where(eq(schema.processingActivities.id, processingId))
    .returning({ id: schema.processingActivities.id });
  if (updated.length > 0) await setProcessors(tx, tenantId, processingId, supplierIds);
  return updated.length;
}

export async function deleteProcessing(tx: TenantTx, processingId: string): Promise<{ name: string } | null> {
  const [row] = await tx
    .delete(schema.processingActivities)
    .where(eq(schema.processingActivities.id, processingId))
    .returning({ name: schema.processingActivities.name });
  return row ?? null;
}
