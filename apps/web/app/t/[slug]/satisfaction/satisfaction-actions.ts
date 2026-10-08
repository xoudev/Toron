'use server';

import { SURVEY_METHODS, appError, canManageSatisfaction, surveyError } from '@toron/core';
import {
  createCustomerSurvey,
  deleteCustomerSurvey,
  getCustomerSurveyRef,
  isTenantMember,
  setCustomerSurveyEvidence,
  updateCustomerSurvey,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

export type { ActionResult };

const authorizeSatisfactionManager = (slug: string) => authorizeRole(
  slug,
  canManageSatisfaction,
  'Votre rôle est en lecture seule — demandez au responsable qualité de consigner cette enquête.',
);

const count = z.number().int().min(0).max(10000000).nullable();
const optionalText = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);

const SurveySchema = z.object({
  title: z.string().trim().min(2).max(200),
  method: z.enum(SURVEY_METHODS),
  segment: optionalText(200),
  closedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invitedCount: count,
  respondents: z.number().int().min(1).max(10000000),
  promoters: count,
  passives: count,
  detractors: count,
  satisfied: count,
  target: z.number().int().min(-100).max(100).nullable(),
  findings: optionalText(4000),
  evidenceId: z.uuid().nullable(),
  ownerUserId: z.uuid().nullable(),
});

const INVALID = 'Enquête incomplète — intitulé, méthode, date de clôture et nombre de répondants sont requis.';
const GONE = 'Cette enquête n’existe plus — rechargez la page.';
const NOT_MEMBER = 'Le responsable choisi ne fait plus partie de l’organisation — choisissez-en un autre.';

/** Ne garde que les résultats de la méthode choisie. */
function results<T extends z.infer<typeof SurveySchema>>(d: T): T {
  return d.method === 'nps' ? { ...d, satisfied: null } : { ...d, promoters: null, passives: null, detractors: null };
}

function auditView(d: z.infer<typeof SurveySchema>) {
  return {
    title: d.title, method: d.method, segment: d.segment, closedOn: d.closedOn, respondents: d.respondents,
    promoters: d.promoters, passives: d.passives, detractors: d.detractors, satisfied: d.satisfied, target: d.target,
  };
}

export async function createCustomerSurveyAction(slug: string, input: unknown): Promise<ActionResult<{ surveyId: string }>> {
  const auth = await authorizeSatisfactionManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SurveySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', INVALID) };
  const d = results(parsed.data);
  const ruleError = surveyError(d, todayParis());
  if (ruleError) return { ok: false, error: appError('ENQUETE_INVALIDE', ruleError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (d.ownerUserId && !(await isTenantMember(tx, d.ownerUserId))) return { kind: 'membre' as const };
      const id = await createCustomerSurvey(tx, { ...d, tenantId: auth.tenantId, createdBy: auth.userId });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'satisfaction.survey_create', objectType: 'customer_survey', objectId: id,
        after: auditView(d), ip: auth.ip, userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const, id };
    });
    if (res.kind === 'membre') return { ok: false, error: appError('RESPONSABLE_INVALIDE', NOT_MEMBER) };
    revalidatePath(`/t/${slug}/satisfaction`);
    return { ok: true, data: { surveyId: res.id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'L’enregistrement de l’enquête a échoué — vérifiez le rapport choisi, puis réessayez.')) };
  }
}

const UpdateSchema = SurveySchema.extend({ surveyId: z.uuid() });

export async function updateCustomerSurveyAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeSatisfactionManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', INVALID) };
  const { surveyId, ...rest } = results(parsed.data);
  const ruleError = surveyError(rest, todayParis());
  if (ruleError) return { ok: false, error: appError('ENQUETE_INVALIDE', ruleError) };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getCustomerSurveyRef(tx, surveyId);
      if (!ref) return { kind: 'introuvable' as const };
      if (rest.ownerUserId && rest.ownerUserId !== ref.ownerUserId && !(await isTenantMember(tx, rest.ownerUserId))) return { kind: 'membre' as const };
      if ((await updateCustomerSurvey(tx, surveyId, rest)) === 0) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'satisfaction.survey_update', objectType: 'customer_survey', objectId: surveyId,
        before: { title: ref.title, method: ref.method, closedOn: ref.closedOn, respondents: ref.respondents }, after: auditView(rest),
        ip: auth.ip, userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE) };
    if (res.kind === 'membre') return { ok: false, error: appError('RESPONSABLE_INVALIDE', NOT_MEMBER) };
    revalidatePath(`/t/${slug}/satisfaction`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour de l’enquête a échoué — vérifiez le rapport choisi, puis réessayez.')) };
  }
}

const RefSchema = z.object({ surveyId: z.uuid() });

export async function deleteCustomerSurveyAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeSatisfactionManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = RefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Suppression invalide — rechargez la page.') };
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getCustomerSurveyRef(tx, parsed.data.surveyId);
      if (!ref || !(await deleteCustomerSurvey(tx, parsed.data.surveyId))) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'satisfaction.survey_delete', objectType: 'customer_survey', objectId: parsed.data.surveyId,
        before: { title: ref.title, method: ref.method, closedOn: ref.closedOn, respondents: ref.respondents }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE) };
    revalidatePath(`/t/${slug}/satisfaction`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression de l’enquête a échoué — réessayez.')) };
  }
}

const ReportSchema = z.object({ surveyId: z.uuid(), evidenceId: z.uuid() });

/** Rattache le rapport d'une enquête, déposé au coffre de preuves. */
export async function attachSurveyReportAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeSatisfactionManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Rapport invalide — rechargez la page.') };
  const { surveyId, evidenceId } = parsed.data;
  try {
    const res = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const ref = await getCustomerSurveyRef(tx, surveyId);
      if (!ref || !(await setCustomerSurveyEvidence(tx, surveyId, evidenceId))) return { kind: 'introuvable' as const };
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'satisfaction.survey_report', objectType: 'customer_survey', objectId: surveyId,
        before: { evidenceId: ref.evidenceId }, after: { evidenceId }, ip: auth.ip, userAgent: auth.userAgent,
      });
      return { kind: 'ok' as const };
    });
    if (res.kind === 'introuvable') return { ok: false, error: appError('INTROUVABLE', GONE) };
    revalidatePath(`/t/${slug}/satisfaction`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_RATTACHEMENT', 'Le rattachement du rapport a échoué — réessayez.')) };
  }
}
