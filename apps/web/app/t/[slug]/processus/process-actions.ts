'use server';

import { appError } from '@toron/core';
import {
  addProcessRisk,
  createProcess,
  getProcess,
  removeProcessRisk,
  setProcessWorkflow,
  withTenant,
  writeAuditEntry,
  type ProcessDetail,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeManager, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';

export type { ActionResult };

const Family = z.enum(['management', 'realisation', 'support']);
const Workflow = z.enum(['brouillon', 'relecture', 'approuve', 'publie']);

export async function createProcessAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      family: Family,
      name: z.string().trim().min(2).max(200),
      pilotUserId: z.uuid().optional().nullable(),
      version: z.string().trim().max(20).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Processus invalide — une famille et un nom sont requis.') };
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const pid = await createProcess(tx, { tenantId: auth.tenantId, family: d.family, name: d.name, pilotUserId: d.pilotUserId ?? null, version: d.version || 'v1.0' });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'process.create', objectType: 'process', objectId: pid, after: { name: d.name, family: d.family }, ip: auth.ip, userAgent: auth.userAgent });
      return pid;
    });
    revalidatePath(`/t/${slug}/processus`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création du processus a échoué — réessayez.')) };
  }
}

export async function setProcessWorkflowAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ processId: z.uuid(), workflow: Workflow }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Statut invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => setProcessWorkflow(tx, parsed.data.processId, parsed.data.workflow));
    revalidatePath(`/t/${slug}/processus`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_STATUT', 'Le changement de statut a échoué.')) };
  }
}

export async function addProcessRiskAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ processId: z.uuid(), riskId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Rattachement invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => addProcessRisk(tx, { tenantId: auth.tenantId, processId: parsed.data.processId, riskId: parsed.data.riskId }));
    revalidatePath(`/t/${slug}/processus`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_RATTACHEMENT', 'Le rattachement du risque a échoué.')) };
  }
}

export async function removeProcessRiskAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ processId: z.uuid(), riskId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Rattachement invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => removeProcessRisk(tx, parsed.data.processId, parsed.data.riskId));
    revalidatePath(`/t/${slug}/processus`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_RATTACHEMENT', 'Le retrait du risque a échoué.')) };
  }
}

export async function getProcessAction(slug: string, processId: string): Promise<ActionResult<ProcessDetail>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(processId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const d = await withTenant(appDb().db, auth.tenantId, (tx) => getProcess(tx, parsed.data));
    if (!d) return { ok: false, error: appError('INTROUVABLE', 'Processus introuvable.') };
    return { ok: true, data: d };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué.')) };
  }
}
