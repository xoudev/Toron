import { createHash, randomBytes } from 'node:crypto';

import {
  notificationHref, portalExpiresOn, supplierResponseRecipients, supplierResponseTitle,
  type PortalDraft, type SupplierAnswers, type SupplierRequestStatus,
} from '@toron/core';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from '../client.ts';
import * as schema from '../schema/index.ts';
import { withTenant, type TenantTx } from '../tenant.ts';

// ── Portail de réponse fournisseur (module 5.10, V2) ───────────────────
// Le jeton circule dans le lien envoyé au fournisseur ; la base ne garde
// que son empreinte. Côté portail, la demande se retrouve par l'empreinte
// (fonction dédiée), puis tout se lit et s'écrit dans le contexte de
// l'organisation concernée, sous RLS.

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Jeton URL-safe de 32 octets aléatoires. */
export function generatePortalToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Forme d'un jeton émis par `generatePortalToken` : le reste est refusé avant toute requête. */
const PORTAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const OPEN: SupplierRequestStatus[] = ['envoyee', 'en_cours'];

export interface SupplierRequestRow {
  id: string;
  supplierId: string;
  contactName: string;
  contactEmail: string;
  message: string | null;
  status: SupplierRequestStatus;
  dueOn: string;
  expiresOn: string;
  answers: Partial<SupplierAnswers>;
  comments: Record<string, string>;
  requestedByName: string | null;
  submittedAt: Date | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  assessmentId: string | null;
  createdAt: Date;
}

/** Demandes adressées à un fournisseur, les plus récentes d'abord. */
export async function listSupplierRequests(tx: TenantTx, supplierId: string): Promise<SupplierRequestRow[]> {
  const rows = (await tx.execute(sql`
    SELECT r.id, r.supplier_id, r.contact_name, r.contact_email, r.message, r.status,
           r.due_on::text AS due_on, r.expires_on::text AS expires_on, r.answers, r.comments,
           req.name AS requested_by_name, r.submitted_at::text AS submitted_at,
           rev.name AS reviewed_by_name, r.reviewed_at::text AS reviewed_at, r.assessment_id,
           r.created_at::text AS created_at
      FROM supplier_requests r
      LEFT JOIN users req ON req.id = r.requested_by
      LEFT JOIN users rev ON rev.id = r.reviewed_by
     WHERE r.supplier_id = ${supplierId}
     ORDER BY r.created_at DESC
  `)) as unknown as {
    id: string; supplier_id: string; contact_name: string; contact_email: string; message: string | null;
    status: SupplierRequestStatus; due_on: string; expires_on: string; answers: Partial<SupplierAnswers>;
    comments: Record<string, string>; requested_by_name: string | null; submitted_at: string | null;
    reviewed_by_name: string | null; reviewed_at: string | null; assessment_id: string | null; created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id, supplierId: r.supplier_id, contactName: r.contact_name, contactEmail: r.contact_email,
    message: r.message, status: r.status, dueOn: r.due_on, expiresOn: r.expires_on, answers: r.answers,
    comments: r.comments, requestedByName: r.requested_by_name,
    submittedAt: r.submitted_at ? new Date(r.submitted_at) : null, reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null, assessmentId: r.assessment_id,
    createdAt: new Date(r.created_at),
  }));
}

export async function getSupplierRequestRef(tx: TenantTx, requestId: string): Promise<{
  supplierId: string; status: SupplierRequestStatus; dueOn: string; contactName: string;
  answers: Partial<SupplierAnswers>; submittedAt: Date | null;
} | null> {
  const [row] = await tx.select({
    supplierId: schema.supplierRequests.supplierId, status: schema.supplierRequests.status,
    dueOn: schema.supplierRequests.dueOn, contactName: schema.supplierRequests.contactName,
    answers: schema.supplierRequests.answers, submittedAt: schema.supplierRequests.submittedAt,
  }).from(schema.supplierRequests).where(eq(schema.supplierRequests.id, requestId));
  return row ?? null;
}

export interface CreateSupplierRequestInput {
  tenantId: string;
  supplierId: string;
  contactName: string;
  contactEmail: string;
  message: string | null;
  dueOn: string;
  requestedBy: string;
}

/** Crée la demande et renvoie le jeton en clair, à transmettre une seule fois. */
export async function createSupplierRequest(tx: TenantTx, input: CreateSupplierRequestInput): Promise<{ id: string; token: string; expiresOn: string }> {
  const token = generatePortalToken();
  const expiresOn = portalExpiresOn(input.dueOn);
  const [row] = await tx.insert(schema.supplierRequests).values({
    tenantId: input.tenantId, supplierId: input.supplierId, contactName: input.contactName,
    contactEmail: input.contactEmail, message: input.message, tokenHash: hashPortalToken(token),
    dueOn: input.dueOn, expiresOn, requestedBy: input.requestedBy,
  }).returning({ id: schema.supplierRequests.id });
  return { id: row!.id, token, expiresOn };
}

/**
 * Nouveau lien pour une demande encore ouverte, avec une nouvelle échéance :
 * l'ancien lien cesse aussitôt de fonctionner.
 */
export async function renewSupplierRequestLink(tx: TenantTx, requestId: string, dueOn: string): Promise<{ token: string; expiresOn: string } | null> {
  const token = generatePortalToken();
  const expiresOn = portalExpiresOn(dueOn);
  const rows = await tx.update(schema.supplierRequests)
    .set({ tokenHash: hashPortalToken(token), dueOn, expiresOn })
    .where(and(eq(schema.supplierRequests.id, requestId), inArray(schema.supplierRequests.status, OPEN)))
    .returning({ id: schema.supplierRequests.id });
  return rows.length > 0 ? { token, expiresOn } : null;
}

/** Annule une demande non encore validée ; son lien cesse de fonctionner. */
export async function cancelSupplierRequest(tx: TenantTx, requestId: string): Promise<boolean> {
  const rows = await tx.update(schema.supplierRequests).set({ status: 'annulee' })
    .where(and(eq(schema.supplierRequests.id, requestId), inArray(schema.supplierRequests.status, [...OPEN, 'soumise'])))
    .returning({ id: schema.supplierRequests.id });
  return rows.length > 0;
}

/** Réponse validée : l'évaluation enregistrée lui est rattachée. */
export async function markSupplierRequestValidated(tx: TenantTx, input: { requestId: string; reviewerUserId: string; assessmentId: string }): Promise<boolean> {
  const rows = await tx.update(schema.supplierRequests).set({
    status: 'validee', reviewedBy: input.reviewerUserId, reviewedAt: sql`now()`, assessmentId: input.assessmentId,
  }).where(and(eq(schema.supplierRequests.id, input.requestId), eq(schema.supplierRequests.status, 'soumise')))
    .returning({ id: schema.supplierRequests.id });
  return rows.length > 0;
}

// ── Côté portail ────────────────────────────────────────────────────────

export interface PortalRequest {
  tenantId: string;
  requestId: string;
  organisationName: string;
  supplierId: string;
  supplierName: string;
  contactName: string;
  message: string | null;
  status: SupplierRequestStatus;
  dueOn: string;
  expiresOn: string;
  answers: Partial<SupplierAnswers>;
  comments: Record<string, string>;
  submittedAt: Date | null;
}

/**
 * Retrouve la demande d'un lien. Le jeton n'est comparé que par son
 * empreinte ; un jeton mal formé ne déclenche aucune requête.
 */
export async function resolvePortalRequest(db: Db, token: string): Promise<PortalRequest | null> {
  if (!PORTAL_TOKEN_PATTERN.test(token)) return null;
  // Seule requête hors contexte d'organisation, comme verify_export : la
  // fonction ne rend que l'organisation et la demande du jeton exact.
  const found = (await db.execute(sql`SELECT tenant_id, request_id FROM supplier_portal_lookup(${hashPortalToken(token)})`)) as unknown as
    { tenant_id: string; request_id: string }[];
  const hit = found[0];
  if (!hit) return null;
  return withTenant(db, hit.tenant_id, async (tx) => {
    const [r] = (await tx.execute(sql`
      SELECT t.name AS organisation_name, s.id AS supplier_id, s.name AS supplier_name, r.contact_name, r.message,
             r.status, r.due_on::text AS due_on, r.expires_on::text AS expires_on, r.answers, r.comments,
             r.submitted_at::text AS submitted_at
        FROM supplier_requests r
        JOIN suppliers s ON s.id = r.supplier_id
        JOIN tenants t ON t.id = r.tenant_id
       WHERE r.id = ${hit.request_id}
    `)) as unknown as {
      organisation_name: string; supplier_id: string; supplier_name: string; contact_name: string; message: string | null;
      status: SupplierRequestStatus; due_on: string; expires_on: string; answers: Partial<SupplierAnswers>;
      comments: Record<string, string>; submitted_at: string | null;
    }[];
    if (!r) return null;
    return {
      tenantId: hit.tenant_id, requestId: hit.request_id, organisationName: r.organisation_name,
      supplierId: r.supplier_id, supplierName: r.supplier_name, contactName: r.contact_name, message: r.message,
      status: r.status, dueOn: r.due_on, expiresOn: r.expires_on, answers: r.answers, comments: r.comments,
      submittedAt: r.submitted_at ? new Date(r.submitted_at) : null,
    };
  });
}

/**
 * Enregistre le brouillon du fournisseur, ou le soumet. Ne touche qu'une
 * demande encore ouverte dont le lien vit : sinon rien n'est écrit.
 */
export async function savePortalDraft(tx: TenantTx, input: { requestId: string; draft: PortalDraft; submit: boolean; today: string }): Promise<boolean> {
  const rows = await tx.update(schema.supplierRequests).set({
    answers: input.draft.answers,
    comments: input.draft.comments,
    status: input.submit ? 'soumise' : 'en_cours',
    ...(input.submit ? { submittedAt: sql`now()` } : {}),
  }).where(and(
    eq(schema.supplierRequests.id, input.requestId),
    inArray(schema.supplierRequests.status, OPEN),
    sql`${schema.supplierRequests.expiresOn} >= ${input.today}::date`,
  )).returning({ id: schema.supplierRequests.id });
  return rows.length > 0;
}

/**
 * Prévient le demandeur et le responsable du fournisseur qu'une réponse est
 * arrivée. Seuls les membres actuels de l'organisation sont notifiés.
 */
export async function notifySupplierResponse(tx: TenantTx, n: { tenantId: string; slug: string; requestId: string }): Promise<number> {
  const [ref] = (await tx.execute(sql`
    SELECT r.requested_by, s.owner_user_id, s.id AS supplier_id, s.name AS supplier_name
      FROM supplier_requests r JOIN suppliers s ON s.id = r.supplier_id
     WHERE r.id = ${n.requestId}
  `)) as unknown as { requested_by: string | null; owner_user_id: string | null; supplier_id: string; supplier_name: string }[];
  if (!ref) return 0;
  const recipients = supplierResponseRecipients({ requestedBy: ref.requested_by, ownerUserId: ref.owner_user_id });
  if (recipients.length === 0) return 0;
  const rows = (await tx.execute(sql`
    INSERT INTO notifications (tenant_id, user_id, kind, subject, title, href)
    SELECT m.tenant_id, m.user_id, 'reponse', 'fournisseur',
           ${supplierResponseTitle(ref.supplier_name)}, ${notificationHref(n.slug, 'fournisseur', ref.supplier_id)}
    FROM memberships m
    WHERE m.tenant_id = ${n.tenantId} AND m.user_id IN (${sql.join(recipients.map((r) => sql`${r}`), sql`, `)})
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length;
}
