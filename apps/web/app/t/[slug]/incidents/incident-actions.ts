'use server';

import { appError } from '@toron/core';
import {
  addEvent,
  closeIncident,
  createIncident,
  getIncident,
  markNotificationSent,
  qualifyIncident,
  withTenant,
  writeAuditEntry,
  type IncidentDetail,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  authorizeManager,
  isActionError,
  logFailure,
  type ActionResult,
} from '@/lib/action-guard';
import { appDb } from '@/lib/db';

export type { ActionResult };

const Severity = z.enum(['mineur', 'majeur', 'critique']);
const NotifKind = z.enum(['alerte_24h', 'notification_72h', 'rapport_30j', 'cnil_72h']);

export async function createIncidentAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ title: z.string().trim().min(2).max(200), description: z.string().trim().max(4000).optional().nullable(), severity: Severity }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Incident invalide — un intitulé (2 caractères min) et une sévérité sont requis.') };
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const iid = await createIncident(tx, { tenantId: auth.tenantId, title: d.title, description: d.description ?? null, severity: d.severity, detectedBy: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'incident.create', objectType: 'incident', objectId: iid, after: { title: d.title, severity: d.severity }, ip: auth.ip, userAgent: auth.userAgent });
      return iid;
    });
    revalidatePath(`/t/${slug}/incidents`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La déclaration de l’incident a échoué — réessayez.')) };
  }
}

export async function qualifyIncidentAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({
    incidentId: z.uuid(),
    nis2Important: z.boolean(),
    gdprBreach: z.boolean(),
    criteria: z.record(z.string(), z.boolean()),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Qualification invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      await qualifyIncident(tx, { tenantId: auth.tenantId, incidentId: d.incidentId, nis2Important: d.nis2Important, criteria: d.criteria, gdprBreach: d.gdprBreach, qualifiedBy: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'incident.qualify', objectType: 'incident', objectId: d.incidentId, after: { nis2Important: d.nis2Important, gdprBreach: d.gdprBreach }, ip: auth.ip, userAgent: auth.userAgent });
    });
    revalidatePath(`/t/${slug}/incidents`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_QUALIFICATION', 'La qualification a échoué — réessayez.')) };
  }
}

export async function addEventAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ incidentId: z.uuid(), kind: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Événement invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => addEvent(tx, { tenantId: auth.tenantId, incidentId: d.incidentId, kind: d.kind, description: d.description, authorUserId: auth.userId }));
    revalidatePath(`/t/${slug}/incidents`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_EVENEMENT', 'L’ajout à la timeline a échoué — réessayez.')) };
  }
}

export async function markNotifSentAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ incidentId: z.uuid(), kind: NotifKind }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      await markNotificationSent(tx, { incidentId: d.incidentId, kind: d.kind });
      await addEvent(tx, { tenantId: auth.tenantId, incidentId: d.incidentId, kind: 'communication', description: `Échéance ${d.kind} marquée transmise.`, authorUserId: auth.userId });
    });
    revalidatePath(`/t/${slug}/incidents`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_NOTIF', 'La mise à jour a échoué — réessayez.')) };
  }
}

export async function closeIncidentAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ incidentId: z.uuid(), rex: z.string().trim().max(4000).optional().nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Clôture invalide.') };
  const d = parsed.data;
  try {
    const outcome = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const res = await closeIncident(tx, { tenantId: auth.tenantId, incidentId: d.incidentId, rex: d.rex ?? null, closedBy: auth.userId });
      if (res.outcome === 'closed') {
        await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'incident.close', objectType: 'incident', objectId: d.incidentId, ip: auth.ip, userAgent: auth.userAgent });
      }
      return res.outcome;
    });
    if (outcome === 'rex_requis') return { ok: false, error: appError('REX_REQUIS', 'Un incident important ne peut être clos sans retour d’expérience (REX).') };
    if (outcome === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Cet incident n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/incidents`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CLOTURE', 'La clôture a échoué — réessayez.')) };
  }
}

export async function getIncidentAction(slug: string, incidentId: string): Promise<ActionResult<IncidentDetail>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(incidentId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const detail = await withTenant(appDb().db, auth.tenantId, (tx) => getIncident(tx, parsed.data));
    if (!detail) return { ok: false, error: appError('INTROUVABLE', 'Incident introuvable.') };
    return { ok: true, data: detail };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué — réessayez.')) };
  }
}
