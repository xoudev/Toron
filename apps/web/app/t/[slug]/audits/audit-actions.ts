'use server';

import { appError } from '@toron/core';
import {
  addFinding,
  convertFindingToAction,
  createAudit,
  getAudit,
  setAuditStatus,
  withTenant,
  writeAuditEntry,
  type AuditDetail,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeManager, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';

export type { ActionResult };

const Status = z.enum(['planifie', 'en_cours', 'clos']);
const FType = z.enum(['conforme', 'observation', 'nc_mineure', 'nc_majeure']);

export async function createAuditAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ title: z.string().trim().min(2).max(200), frameworkId: z.uuid().optional().nullable(), scopeId: z.uuid().optional().nullable(), plannedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), leadAuditor: z.uuid().optional().nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Audit invalide — un intitulé est requis.') };
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const aid = await createAudit(tx, { tenantId: auth.tenantId, title: d.title, frameworkId: d.frameworkId ?? null, scopeId: d.scopeId ?? null, plannedAt: d.plannedAt ?? null, leadAuditor: d.leadAuditor ?? null });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'audit.create', objectType: 'audit', objectId: aid, after: { title: d.title }, ip: auth.ip, userAgent: auth.userAgent });
      return aid;
    });
    revalidatePath(`/t/${slug}/audits`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création de l’audit a échoué — réessayez.')) };
  }
}

export async function setAuditStatusAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ auditId: z.uuid(), status: Status }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Statut invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => setAuditStatus(tx, parsed.data.auditId, parsed.data.status));
    revalidatePath(`/t/${slug}/audits`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_STATUT', 'Le changement de statut a échoué.')) };
  }
}

export async function addFindingAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ auditId: z.uuid(), requirementRef: z.string().trim().max(40).optional().nullable(), type: FType, description: z.string().trim().min(2).max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Constat invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => addFinding(tx, { tenantId: auth.tenantId, auditId: d.auditId, requirementRef: d.requirementRef ?? null, type: d.type, description: d.description }));
    revalidatePath(`/t/${slug}/audits`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CONSTAT', 'L’ajout du constat a échoué.')) };
  }
}

export async function convertFindingAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ findingId: z.uuid(), auditId: z.uuid(), title: z.string().trim().min(2).max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Conversion invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const aid = await convertFindingToAction(tx, { tenantId: auth.tenantId, findingId: d.findingId, auditId: d.auditId, title: d.title, ownerUserId: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'audit.finding_to_action', objectType: 'action', objectId: aid, after: { findingId: d.findingId }, ip: auth.ip, userAgent: auth.userAgent });
    });
    revalidatePath(`/t/${slug}/audits`);
    revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CONVERSION', 'La conversion en action a échoué.')) };
  }
}

export async function getAuditAction(slug: string, auditId: string): Promise<ActionResult<AuditDetail>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(auditId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const d = await withTenant(appDb().db, auth.tenantId, (tx) => getAudit(tx, parsed.data));
    if (!d) return { ok: false, error: appError('INTROUVABLE', 'Audit introuvable.') };
    return { ok: true, data: d };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué.')) };
  }
}
