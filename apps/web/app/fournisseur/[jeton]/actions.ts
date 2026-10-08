'use server';

import { SUPPLIER_QUESTIONS, appError, cleanPortalDraft, portalAccess, portalMissing } from '@toron/core';
import { notifySupplierResponse, resolvePortalRequest, savePortalDraft, withTenant, writeAuditEntry } from '@toron/db';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { logFailure, normalizeIp, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';

// Réponse du fournisseur par son lien personnel. Aucune session : le jeton
// est la seule autorisation, revérifiée à chaque enregistrement.

const Key = z.string().max(40);
const DraftSchema = z.object({
  answers: z.record(Key, z.string().max(20)).refine((o) => Object.keys(o).length <= SUPPLIER_QUESTIONS.length * 2, 'Trop de réponses.'),
  comments: z.record(Key, z.string().max(2000)).refine((o) => Object.keys(o).length <= SUPPLIER_QUESTIONS.length * 2, 'Trop de commentaires.'),
  submit: z.boolean(),
});

const CLOSED = 'Ce lien n’accepte plus de réponse : il a expiré, la demande a été close ou vos réponses ont déjà été envoyées — rechargez la page.';

export async function savePortalAction(token: string, input: unknown): Promise<ActionResult<{ submitted: boolean }>> {
  const parsed = DraftSchema.safeParse(input);
  if (typeof token !== 'string' || !parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Réponses illisibles — rechargez la page, puis réessayez.') };
  }
  const draft = cleanPortalDraft(parsed.data.answers, parsed.data.comments);
  const submit = parsed.data.submit;
  if (submit) {
    const missing = portalMissing(draft.answers).length;
    if (missing > 0) {
      const hint = missing > 1 ? 'pour celles qui ne concernent pas votre prestation' : 'si elle ne concerne pas votre prestation';
      return { ok: false, error: appError('REPONSES_INCOMPLETES', `Il reste ${missing} question${missing > 1 ? 's' : ''} sans réponse — choisissez « Sans objet » ${hint}.`) };
    }
  }
  try {
    const request = await resolvePortalRequest(appDb().db, token);
    const today = todayParis();
    if (!request || portalAccess(request.status, request.expiresOn, today) !== 'ouvert') {
      return { ok: false, error: appError('LIEN_CLOS', CLOSED) };
    }
    const h = await headers();
    const saved = await withTenant(appDb().db, request.tenantId, async (tx) => {
      const ok = await savePortalDraft(tx, { requestId: request.requestId, draft, submit, today });
      if (!ok) return false;
      await writeAuditEntry(tx, {
        tenantId: request.tenantId, action: submit ? 'supplier_portal.submit' : 'supplier_portal.save',
        objectType: 'supplier_request', objectId: request.requestId,
        after: { answered: Object.keys(draft.answers).length, comments: Object.keys(draft.comments).length },
        ip: normalizeIp(h.get('x-forwarded-for')), userAgent: h.get('user-agent') || undefined,
      });
      if (submit) await notifySupplierResponse(tx, { tenantId: request.tenantId, slug: request.organisationSlug, requestId: request.requestId });
      return true;
    });
    if (!saved) return { ok: false, error: appError('LIEN_CLOS', CLOSED) };
    if (submit) revalidatePath(`/t/${request.organisationSlug}/fournisseurs`);
    return { ok: true, data: { submitted: submit } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ENREGISTREMENT', 'Vos réponses n’ont pas pu être enregistrées — réessayez dans un instant.')) };
  }
}
