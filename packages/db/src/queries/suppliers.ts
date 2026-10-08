import type { AttestationKind, SupplierAnswers, SupplierRating } from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';
import { listSupplierRequests, type SupplierRequestRow } from './supplier-requests.ts';

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
  lastAssessedOn: string | null;
  lastScore: number | null;
  lastRating: SupplierRating | null;
  attestationCount: number;
  /** Plus proche échéance parmi les attestations datées. */
  nextAttestationExpiry: string | null;
  openActionCount: number;
  /** Réponses reçues par le portail, en attente d'examen. */
  responsesToReview: number;
  /** Échéance la plus proche des demandes encore ouvertes au fournisseur. */
  openRequestDueOn: string | null;
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
  last_assessed_on: string | null;
  last_score: number | null;
  last_rating: SupplierRating | null;
  attestation_count: string;
  next_attestation_expiry: string | null;
  open_action_count: string;
  responses_to_review: string;
  open_request_due_on: string | null;
}

/** Registre des fournisseurs, triés par criticité (T1 d'abord). */
export async function listSuppliers(tx: TenantTx): Promise<SupplierSummary[]> {
  const rows = await tx.execute(sql`
    SELECT s.id, s.name, s.tier, s.services, s.data_categories, s.contract_status,
           o.name AS owner_name, s.owner_user_id, s.next_review::text AS next_review,
           la.assessed_on::text AS last_assessed_on, la.score AS last_score, la.rating AS last_rating,
           (SELECT count(*) FROM supplier_attestations t WHERE t.supplier_id = s.id) AS attestation_count,
           (SELECT min(t.valid_until)::text FROM supplier_attestations t WHERE t.supplier_id = s.id) AS next_attestation_expiry,
           (SELECT count(*) FROM actions a WHERE a.origin_type = 'supplier' AND a.origin_id = s.id AND a.status <> 'termine') AS open_action_count,
           (SELECT count(*) FROM supplier_requests r WHERE r.supplier_id = s.id AND r.status = 'soumise') AS responses_to_review,
           (SELECT min(r.due_on)::text FROM supplier_requests r
             WHERE r.supplier_id = s.id AND r.status IN ('envoyee', 'en_cours')) AS open_request_due_on
    FROM suppliers s LEFT JOIN users o ON o.id = s.owner_user_id
    LEFT JOIN LATERAL (
      SELECT sa.assessed_on, sa.score, sa.rating FROM supplier_assessments sa
      WHERE sa.supplier_id = s.id ORDER BY sa.assessed_on DESC, sa.created_at DESC LIMIT 1
    ) la ON true
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
    lastAssessedOn: r.last_assessed_on,
    lastScore: r.last_score,
    lastRating: r.last_rating,
    attestationCount: Number(r.attestation_count),
    nextAttestationExpiry: r.next_attestation_expiry,
    openActionCount: Number(r.open_action_count),
    responsesToReview: Number(r.responses_to_review),
    openRequestDueOn: r.open_request_due_on,
  }));
}

// ── Évaluations, attestations et actions correctives ────────────────────

/** Nom et criticité d'un fournisseur de l'organisation courante, ou null. */
export async function getSupplierRef(tx: TenantTx, supplierId: string): Promise<{ name: string; tier: SupplierTier; ownerUserId: string | null } | null> {
  const [row] = await tx
    .select({ name: schema.suppliers.name, tier: schema.suppliers.tier, ownerUserId: schema.suppliers.ownerUserId })
    .from(schema.suppliers)
    .where(eq(schema.suppliers.id, supplierId));
  return row ?? null;
}

export interface RecordSupplierAssessmentInput {
  tenantId: string;
  supplierId: string;
  assessorUserId: string;
  assessedOn: string;
  answers: SupplierAnswers;
  score: number;
  rating: SupplierRating;
  notes?: string | null;
}

/** Enregistre une évaluation ; la note et l'appréciation viennent du cœur métier. */
export async function recordSupplierAssessment(tx: TenantTx, input: RecordSupplierAssessmentInput): Promise<string> {
  const [row] = await tx
    .insert(schema.supplierAssessments)
    .values({
      tenantId: input.tenantId,
      supplierId: input.supplierId,
      assessorUserId: input.assessorUserId,
      assessedOn: input.assessedOn,
      answers: input.answers,
      score: input.score,
      rating: input.rating,
      notes: input.notes ?? null,
    })
    .returning({ id: schema.supplierAssessments.id });
  return row!.id;
}

export interface AddSupplierAttestationInput {
  tenantId: string;
  supplierId: string;
  kind: AttestationKind;
  label?: string | null;
  issuedOn?: string | null;
  validUntil?: string | null;
  createdBy: string;
}

export async function addSupplierAttestation(tx: TenantTx, input: AddSupplierAttestationInput): Promise<string> {
  const [row] = await tx
    .insert(schema.supplierAttestations)
    .values({
      tenantId: input.tenantId,
      supplierId: input.supplierId,
      kind: input.kind,
      label: input.label ?? null,
      issuedOn: input.issuedOn ?? null,
      validUntil: input.validUntil ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: schema.supplierAttestations.id });
  return row!.id;
}

/** Retire une attestation ; renvoie le fournisseur concerné, ou null si elle n'existe pas. */
export async function removeSupplierAttestation(tx: TenantTx, attestationId: string): Promise<{ supplierId: string; kind: AttestationKind } | null> {
  const [row] = await tx
    .delete(schema.supplierAttestations)
    .where(eq(schema.supplierAttestations.id, attestationId))
    .returning({ supplierId: schema.supplierAttestations.supplierId, kind: schema.supplierAttestations.kind });
  return row ?? null;
}

export interface SupplierAssessmentRow {
  id: string;
  assessedOn: string;
  assessorName: string | null;
  answers: SupplierAnswers;
  score: number;
  rating: SupplierRating;
  notes: string | null;
}

export interface SupplierAttestationRow {
  id: string;
  kind: AttestationKind;
  label: string | null;
  issuedOn: string | null;
  validUntil: string | null;
}

export interface SupplierActionRow {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
}

export interface SupplierDetail {
  assessments: SupplierAssessmentRow[];
  attestations: SupplierAttestationRow[];
  actions: SupplierActionRow[];
  /** Demandes de réponse adressées au fournisseur par le portail. */
  requests: SupplierRequestRow[];
}

export async function getSupplierDetail(tx: TenantTx, supplierId: string): Promise<SupplierDetail | null> {
  if (!(await getSupplierRef(tx, supplierId))) return null;
  const assessments = (await tx.execute(sql`
    SELECT sa.id, sa.assessed_on::text AS assessed_on, u.name AS assessor_name, sa.answers, sa.score, sa.rating, sa.notes
    FROM supplier_assessments sa LEFT JOIN users u ON u.id = sa.assessor_user_id
    WHERE sa.supplier_id = ${supplierId}
    ORDER BY sa.assessed_on DESC, sa.created_at DESC
  `)) as unknown as { id: string; assessed_on: string; assessor_name: string | null; answers: unknown; score: number; rating: SupplierRating; notes: string | null }[];
  const attestations = (await tx.execute(sql`
    SELECT id, kind, label, issued_on::text AS issued_on, valid_until::text AS valid_until
    FROM supplier_attestations WHERE supplier_id = ${supplierId}
    ORDER BY valid_until NULLS LAST, created_at
  `)) as unknown as { id: string; kind: AttestationKind; label: string | null; issued_on: string | null; valid_until: string | null }[];
  const actions = (await tx.execute(sql`
    SELECT id, title, status, due_date::text AS due_date FROM actions
    WHERE origin_type = 'supplier' AND origin_id = ${supplierId}
    ORDER BY created_at
  `)) as unknown as { id: string; title: string; status: string; due_date: string | null }[];
  const parse = (v: unknown): SupplierAnswers => (typeof v === 'string' ? JSON.parse(v) : v) as SupplierAnswers;
  return {
    assessments: assessments.map((a) => ({ id: a.id, assessedOn: a.assessed_on, assessorName: a.assessor_name, answers: parse(a.answers), score: a.score, rating: a.rating, notes: a.notes })),
    attestations: attestations.map((t) => ({ id: t.id, kind: t.kind, label: t.label, issuedOn: t.issued_on, validUntil: t.valid_until })),
    actions: actions.map((a) => ({ id: a.id, title: a.title, status: a.status, dueDate: a.due_date })),
    requests: await listSupplierRequests(tx, supplierId),
  };
}
