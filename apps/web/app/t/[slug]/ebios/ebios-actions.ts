'use server';

import { appError } from '@toron/core';
import {
  addAction,
  addScenario,
  createExport,
  createStudy,
  generateRiskFromScenario,
  getStudy,
  listExportsForObject,
  setWorkshop,
  withTenant,
  writeAuditEntry,
  type ExportSummary,
  type StudyDetail,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeManager, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';

export type { ActionResult };

const Phase = z.enum(['connaitre', 'rentrer', 'trouver', 'exploiter']);

export async function createStudyAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ title: z.string().trim().min(2).max(200), scopeId: z.uuid().optional().nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Étude invalide — un intitulé est requis.') };
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const sid = await createStudy(tx, { tenantId: auth.tenantId, title: parsed.data.title, scopeId: parsed.data.scopeId ?? null });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'ebios.create', objectType: 'ebios_study', objectId: sid, after: { title: parsed.data.title }, ip: auth.ip, userAgent: auth.userAgent });
      return sid;
    });
    revalidatePath(`/t/${slug}/ebios`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création de l’étude a échoué — réessayez.')) };
  }
}

export async function setWorkshopAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ studyId: z.uuid(), workshop: z.number().int().min(1).max(5) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Atelier invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => setWorkshop(tx, parsed.data.studyId, parsed.data.workshop));
    revalidatePath(`/t/${slug}/ebios`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ATELIER', 'Le changement d’atelier a échoué.')) };
  }
}

export async function addScenarioAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ studyId: z.uuid(), riskSource: z.string().trim().min(2).max(200), targetObjective: z.string().trim().min(2).max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Scénario invalide — source et objectif requis.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => addScenario(tx, { tenantId: auth.tenantId, studyId: parsed.data.studyId, riskSource: parsed.data.riskSource, targetObjective: parsed.data.targetObjective }));
    revalidatePath(`/t/${slug}/ebios`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SCENARIO', 'L’ajout du scénario a échoué.')) };
  }
}

export async function addActionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({ scenarioId: z.uuid(), phase: Phase, label: z.string().trim().min(2).max(300), mitreId: z.string().trim().max(20).optional().nullable(), mitreName: z.string().trim().max(80).optional().nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Action invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => addAction(tx, { tenantId: auth.tenantId, scenarioId: d.scenarioId, phase: d.phase, label: d.label, mitreId: d.mitreId ?? null, mitreName: d.mitreName ?? null }));
    revalidatePath(`/t/${slug}/ebios`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ACTION', 'L’ajout de l’action a échoué.')) };
  }
}

export async function generateRiskAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ scenarioId: z.uuid(), scopeId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Génération invalide — un périmètre est requis.') };
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const riskId = await generateRiskFromScenario(tx, { tenantId: auth.tenantId, scenarioId: parsed.data.scenarioId, scopeId: parsed.data.scopeId, ratedBy: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'ebios.generate_risk', objectType: 'risk', objectId: riskId, after: { scenarioId: parsed.data.scenarioId }, ip: auth.ip, userAgent: auth.userAgent });
    });
    revalidatePath(`/t/${slug}/ebios`);
    revalidatePath(`/t/${slug}/risques`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_GENERATION', 'La génération du risque a échoué — le scénario doit être coté.')) };
  }
}

/** Demande le livrable EBIOS RM scellé (poinçon SHA-256 + page /verifier). */
export async function requestEbiosExportAction(slug: string, input: unknown): Promise<ActionResult<{ exportId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ studyId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence d’étude invalide.') };
  try {
    const exportId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createExport(tx, { tenantId: auth.tenantId, type: 'ebios', objectRef: parsed.data.studyId, requestedBy: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'export.request', objectType: 'export', objectId: id, after: { type: 'ebios', studyId: parsed.data.studyId }, ip: auth.ip, userAgent: auth.userAgent });
      return id;
    });
    revalidatePath(`/t/${slug}/ebios`);
    return { ok: true, data: { exportId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_EXPORT', 'La demande de livrable a échoué — réessayez.')) };
  }
}

export async function listStudyExportsAction(slug: string, studyId: string): Promise<ActionResult<ExportSummary[]>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(studyId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const list = await withTenant(appDb().db, auth.tenantId, (tx) => listExportsForObject(tx, parsed.data));
    return { ok: true, data: list };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué.')) };
  }
}

export async function getStudyAction(slug: string, studyId: string): Promise<ActionResult<StudyDetail>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(studyId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const d = await withTenant(appDb().db, auth.tenantId, (tx) => getStudy(tx, parsed.data));
    if (!d) return { ok: false, error: appError('INTROUVABLE', 'Étude introuvable.') };
    return { ok: true, data: d };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué.')) };
  }
}
