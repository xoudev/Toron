'use server';

import {
  ATTESTATION_KINDS,
  SUPPLIER_ANSWERS,
  SUPPLIER_QUESTIONS,
  appError,
  assessSupplier,
  supplierCorrectiveDefaults,
  supplierQuestion,
} from '@toron/core';
import {
  addSupplierAttestation,
  createAction,
  createSupplier,
  getSupplierDetail,
  getSupplierRef,
  recordSupplierAssessment,
  removeSupplierAttestation,
  updateSupplier,
  withTenant,
  writeAuditEntry,
  type SupplierDetail,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  authorizeManager,
  authorizeRole,
  isActionError,
  logFailure,
  type ActionResult,
} from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

export type { ActionResult };

const Tier = z.enum(['t1', 't2', 't3']);
const Contract = z.enum(['a_faire', 'en_cours', 'conforme']);
const Shape = {
  name: z.string().trim().min(2).max(200),
  tier: Tier,
  services: z.string().trim().max(2000).optional().nullable(),
  dataCategories: z.array(z.string().trim().max(120)).max(20).optional(),
  contractStatus: Contract,
  ownerUserId: z.uuid().optional().nullable(),
  nextReview: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
};

export async function createSupplierAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object(Shape).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Fournisseur invalide — un nom et un niveau sont requis.') };
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const sid = await createSupplier(tx, { tenantId: auth.tenantId, name: d.name, tier: d.tier, services: d.services ?? null, dataCategories: d.dataCategories ?? [], contractStatus: d.contractStatus, ownerUserId: d.ownerUserId ?? null, nextReview: d.nextReview ?? null });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'supplier.create', objectType: 'supplier', objectId: sid, after: { name: d.name, tier: d.tier }, ip: auth.ip, userAgent: auth.userAgent });
      return sid;
    });
    revalidatePath(`/t/${slug}/fournisseurs`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création du fournisseur a échoué — réessayez.')) };
  }
}

export async function updateSupplierAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ supplierId: z.uuid(), ...Shape }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Modifications invalides.') };
  const d = parsed.data;
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await updateSupplier(tx, { supplierId: d.supplierId, name: d.name, tier: d.tier, services: d.services ?? null, dataCategories: d.dataCategories ?? [], contractStatus: d.contractStatus, ownerUserId: d.ownerUserId ?? null, nextReview: d.nextReview ?? null });
      if (affected > 0) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'supplier.update', objectType: 'supplier', objectId: d.supplierId, after: { contractStatus: d.contractStatus }, ip: auth.ip, userAgent: auth.userAgent });
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('INTROUVABLE', 'Ce fournisseur n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/fournisseurs`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour a échoué — réessayez.')) };
  }
}

// ── Évaluation, attestations, actions correctives ──────────────────────

const authorizeReader = (slug: string) => authorizeRole(slug, () => true, 'Accès refusé.');
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function getSupplierDetailAction(slug: string, supplierId: string): Promise<ActionResult<SupplierDetail>> {
  const auth = await authorizeReader(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(supplierId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const d = await withTenant(appDb().db, auth.tenantId, (tx) => getSupplierDetail(tx, parsed.data));
    if (!d) return { ok: false, error: appError('INTROUVABLE', 'Ce fournisseur n’existe plus — rechargez la page.') };
    return { ok: true, data: d };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture du fournisseur a échoué — réessayez.')) };
  }
}

const AssessmentSchema = z.object({
  supplierId: z.uuid(),
  assessedOn: Day,
  answers: z.object(Object.fromEntries(SUPPLIER_QUESTIONS.map((q) => [q.key, z.enum(SUPPLIER_ANSWERS)]))).strict(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export async function recordSupplierAssessmentAction(slug: string, input: unknown): Promise<ActionResult<{ score: number }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = AssessmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Évaluation incomplète — répondez à chaque question (« Sans objet » si elle ne s’applique pas).') };
  const d = parsed.data;
  if (d.assessedOn > todayParis() || d.assessedOn < '2000-01-01') {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'La date d’évaluation ne peut pas être dans le futur.') };
  }
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getSupplierRef(tx, d.supplierId);
      if (!ref) return null;
      const result = assessSupplier(d.answers, ref.tier);
      if (!result.ok) return result;
      const id = await recordSupplierAssessment(tx, {
        tenantId: auth.tenantId, supplierId: d.supplierId, assessorUserId: auth.userId, assessedOn: d.assessedOn,
        answers: d.answers, score: result.score, rating: result.rating, notes: d.notes || null,
      });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'supplier.assessment', objectType: 'supplier', objectId: d.supplierId, after: { assessmentId: id, score: result.score, rating: result.rating }, ip: auth.ip, userAgent: auth.userAgent });
      return result;
    });
    if (res === null) return { ok: false, error: appError('INTROUVABLE', 'Ce fournisseur n’existe plus — rechargez la page.') };
    if (!res.ok) return { ok: false, error: appError('SAISIE_INVALIDE', res.reason === 'sans_objet' ? 'Au moins une question doit s’appliquer à ce fournisseur.' : 'Évaluation incomplète — répondez à chaque question.') };
    revalidatePath(`/t/${slug}/fournisseurs`);
    return { ok: true, data: { score: res.score } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’enregistrement de l’évaluation a échoué — réessayez.')) };
  }
}

const AttestationSchema = z.object({
  supplierId: z.uuid(),
  kind: z.enum(ATTESTATION_KINDS),
  label: z.string().trim().max(200).optional().nullable(),
  issuedOn: Day.optional().nullable(),
  validUntil: Day.optional().nullable(),
});

export async function addSupplierAttestationAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = AttestationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Attestation invalide — choisissez un type et des dates au format JJ/MM/AAAA.') };
  const d = parsed.data;
  if (d.issuedOn && d.validUntil && d.validUntil < d.issuedOn) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'La fin de validité précède la date de délivrance — vérifiez les deux dates.') };
  }
  try {
    const ok = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (!(await getSupplierRef(tx, d.supplierId))) return false;
      const id = await addSupplierAttestation(tx, { tenantId: auth.tenantId, supplierId: d.supplierId, kind: d.kind, label: d.label || null, issuedOn: d.issuedOn || null, validUntil: d.validUntil || null, createdBy: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'supplier.attestation.add', objectType: 'supplier', objectId: d.supplierId, after: { attestationId: id, kind: d.kind, validUntil: d.validUntil ?? null }, ip: auth.ip, userAgent: auth.userAgent });
      return true;
    });
    if (!ok) return { ok: false, error: appError('INTROUVABLE', 'Ce fournisseur n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/fournisseurs`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’ajout de l’attestation a échoué — réessayez.')) };
  }
}

export async function removeSupplierAttestationAction(slug: string, attestationId: string): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(attestationId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const removed = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const r = await removeSupplierAttestation(tx, parsed.data);
      if (r) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'supplier.attestation.remove', objectType: 'supplier', objectId: r.supplierId, before: { attestationId: parsed.data, kind: r.kind }, ip: auth.ip, userAgent: auth.userAgent });
      return r;
    });
    if (!removed) return { ok: false, error: appError('INTROUVABLE', 'Cette attestation a déjà été retirée — rechargez la page.') };
    revalidatePath(`/t/${slug}/fournisseurs`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'Le retrait de l’attestation a échoué — réessayez.')) };
  }
}

export async function requestSupplierActionAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ supplierId: z.uuid(), questionKey: z.string().max(40) }).safeParse(input);
  const question = parsed.success ? supplierQuestion(parsed.data.questionKey) : undefined;
  if (!parsed.success || !question) return { ok: false, error: appError('SAISIE_INVALIDE', 'Demande invalide.') };
  const { supplierId } = parsed.data;
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getSupplierRef(tx, supplierId);
      if (!ref) return { kind: 'introuvable' as const };
      const title = `${ref.name} — ${question.correctiveAction}`;
      const detail = await getSupplierDetail(tx, supplierId);
      if (detail?.actions.some((a) => a.title === title && a.status !== 'termine')) return { kind: 'doublon' as const };
      const { priority, dueDate } = supplierCorrectiveDefaults(question, ref.tier, todayParis());
      const id = await createAction(tx, { tenantId: auth.tenantId, title, originType: 'supplier', originId: supplierId, ownerUserId: ref.ownerUserId ?? auth.userId, priority, dueDate });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'supplier.corrective_action', objectType: 'action', objectId: id, after: { supplierId, question: question.key }, ip: auth.ip, userAgent: auth.userAgent });
      return { kind: 'ok' as const, id };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Ce fournisseur n’existe plus — rechargez la page.') };
    if (res.kind === 'doublon') return { ok: false, error: appError('DEJA_DEMANDEE', 'Cette action est déjà ouverte dans le plan d’action.') };
    revalidatePath(`/t/${slug}/fournisseurs`);
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: { id: res.id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ACTION', 'La création de l’action corrective a échoué — réessayez.')) };
  }
}
