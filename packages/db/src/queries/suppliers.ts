import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des fournisseurs (module 5.10) ──────────────────────
export type SupplierTier = 't1' | 't2' | 't3';
export type ContractStatus = 'a_faire' | 'en_cours' | 'conforme';

export interface CreateSupplierInput {
  tenantId: string;
  name: string;
  tier: SupplierTier;
  services?: string | null;
  dataCategories?: string[];
  contractStatus?: ContractStatus;
  ownerUserId?: string | null;
  nextReview?: string | null;
}

export async function createSupplier(tx: TenantTx, input: CreateSupplierInput): Promise<string> {
  const [row] = await tx
    .insert(schema.suppliers)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      tier: input.tier,
      services: input.services ?? null,
      dataCategories: input.dataCategories ?? [],
      contractStatus: input.contractStatus ?? 'a_faire',
      ownerUserId: input.ownerUserId ?? null,
      nextReview: input.nextReview ?? null,
    })
    .returning({ id: schema.suppliers.id });
  return row!.id;
}

export interface UpdateSupplierInput {
  supplierId: string;
  name?: string;
  tier?: SupplierTier;
  services?: string | null;
  dataCategories?: string[];
  contractStatus?: ContractStatus;
  ownerUserId?: string | null;
  nextReview?: string | null;
}

export async function updateSupplier(tx: TenantTx, input: UpdateSupplierInput): Promise<number> {
  const set: Partial<typeof schema.suppliers.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.tier !== undefined) set.tier = input.tier;
  if (input.services !== undefined) set.services = input.services;
  if (input.dataCategories !== undefined) set.dataCategories = input.dataCategories;
  if (input.contractStatus !== undefined) set.contractStatus = input.contractStatus;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.nextReview !== undefined) set.nextReview = input.nextReview;
  if (Object.keys(set).length === 0) return 0;
  const updated = await tx
    .update(schema.suppliers)
    .set(set)
    .where(eq(schema.suppliers.id, input.supplierId))
    .returning({ id: schema.suppliers.id });
  return updated.length;
}

export interface SupplierSummary {
  id: string;
  name: string;
  tier: SupplierTier;
  services: string | null;
  dataCategories: string[];
  contractStatus: ContractStatus;
  ownerName: string | null;
  ownerUserId: string | null;
  nextReview: string | null;
}

interface RawSupplier {
  id: string;
  name: string;
  tier: SupplierTier;
  services: string | null;
  data_categories: string[];
  contract_status: ContractStatus;
  owner_name: string | null;
  owner_user_id: string | null;
  next_review: string | null;
}

/** Registre des fournisseurs, triés par criticité (T1 d'abord). */
export async function listSuppliers(tx: TenantTx): Promise<SupplierSummary[]> {
  const rows = await tx.execute(sql`
    SELECT s.id, s.name, s.tier, s.services, s.data_categories, s.contract_status,
           o.name AS owner_name, s.owner_user_id, s.next_review::text AS next_review
    FROM suppliers s LEFT JOIN users o ON o.id = s.owner_user_id
    ORDER BY s.tier, s.name
  `);
  return (rows as unknown as RawSupplier[]).map((r) => ({
    id: r.id,
    name: r.name,
    tier: r.tier,
    services: r.services,
    dataCategories: r.data_categories,
    contractStatus: r.contract_status,
    ownerName: r.owner_name,
    ownerUserId: r.owner_user_id,
    nextReview: r.next_review,
  }));
}
