'use server';

import {
  appError,
  ASSESSMENT_ITEM_STATUSES,
  isSoaItemValid,
  suggestInheritedStatuses,
  type StatusSuggestion,
} from '@toron/core';
import {
  closeAssessment,
  createAssessment,
  getMutualizedPeers,
  setAssessmentItemStatus,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { authorizeManager, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';

function revalidateDetail(slug: string, frameworkId: string) {
  revalidatePath(`/t/${slug}/referentiels/${frameworkId}`, 'page');
  revalidatePath(`/t/${slug}/referentiels`, 'layout');
}

export async function createAssessmentAction(
  slug: string,
  input: { frameworkId: string; scopeId: string; campaignLabel: string },
): Promise<ActionResult<{ assessmentId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      frameworkId: z.uuid(),
      scopeId: z.uuid(),
      campaignLabel: z.string().trim().min(2, '2 caractères minimum').max(160),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Campagne invalide — choisissez un périmètre et un intitulé.') };
  }
  try {
    const assessmentId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createAssessment(tx, {
        tenantId: auth.tenantId,
        frameworkId: parsed.data.frameworkId,
        scopeId: parsed.data.scopeId,
        campaignLabel: parsed.data.campaignLabel,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'assessment.create',
        objectType: 'assessment',
        objectId: id,
        after: { campaignLabel: parsed.data.campaignLabel },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidateDetail(slug, parsed.data.frameworkId);
    return { ok: true, data: { assessmentId } };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_CAMPAGNE', 'La création de la campagne a échoué — réessayez.')),
    };
  }
}

export async function setItemStatusAction(
  slug: string,
  input: {
    frameworkId: string;
    assessmentId: string;
    requirementId: string;
    status: string;
    statement?: string | null;
    soaIncluded?: boolean;
    soaJustification?: string | null;
  },
): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      frameworkId: z.uuid(),
      assessmentId: z.uuid(),
      requirementId: z.uuid(),
      status: z.enum(ASSESSMENT_ITEM_STATUSES),
      statement: z.string().trim().max(2000).nullish(),
      soaIncluded: z.boolean().optional(),
      soaJustification: z.string().trim().max(2000).nullish(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Statut invalide — rechargez la page et réessayez.') };
  }
  // Validation métier en amont (miroir du CHECK en base, S2) : message clair
  // avant l'aller-retour DB.
  if (!isSoaItemValid({ status: parsed.data.status, soaJustification: parsed.data.soaJustification ?? null })) {
    return {
      ok: false,
      error: appError('JUSTIFICATION_REQUISE', 'Une exclusion (non applicable) exige une justification — saisissez-la, puis validez.'),
    };
  }
  try {
    const affected = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const n = await setAssessmentItemStatus(tx, {
        assessmentId: parsed.data.assessmentId,
        requirementId: parsed.data.requirementId,
        status: parsed.data.status,
        statement: parsed.data.statement ?? null,
        soaIncluded: parsed.data.soaIncluded,
        soaJustification: parsed.data.soaJustification ?? null,
        assessedBy: auth.userId,
      });
      if (n > 0) {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'assessment.set_status',
          objectType: 'assessment_item',
          objectId: parsed.data.requirementId,
          after: { status: parsed.data.status },
          ip: auth.ip,
          userAgent: auth.userAgent,
        });
      }
      return n;
    });
    if (affected === 0) {
      return { ok: false, error: appError('ITEM_INTROUVABLE', 'Cette exigence n’est pas dans la campagne — rechargez la page.') };
    }
    revalidateDetail(slug, parsed.data.frameworkId);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_STATUT', 'L’enregistrement du statut a échoué — réessayez.')),
    };
  }
}

/**
 * Suggestions d'héritage de statut (lecture) : exigences d'autres
 * référentiels couvertes par un même contrôle, pour lesquelles le statut
 * conforme peut être hérité — l'humain valide (RM §5.3).
 */
export async function getInheritedSuggestionsAction(
  slug: string,
  input: { requirementId: string; sourceRef: string; sourceStatus: string },
): Promise<ActionResult<StatusSuggestion[]>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      requirementId: z.uuid(),
      sourceRef: z.string().max(40),
      sourceStatus: z.enum(ASSESSMENT_ITEM_STATUSES),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  }
  try {
    const peers = await withTenant(appDb().db, auth.tenantId, (tx) =>
      getMutualizedPeers(tx, parsed.data.requirementId),
    );
    const suggestions = suggestInheritedStatuses(
      { status: parsed.data.sourceStatus, requirementRef: parsed.data.sourceRef },
      peers,
    );
    return { ok: true, data: suggestions };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_SUGGESTION', 'Le calcul des suggestions a échoué.')),
    };
  }
}

export async function closeAssessmentAction(
  slug: string,
  input: { frameworkId: string; assessmentId: string },
): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ frameworkId: z.uuid(), assessmentId: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de campagne invalide.') };
  }
  try {
    const closed = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const n = await closeAssessment(tx, parsed.data.assessmentId);
      if (n > 0) {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'assessment.close',
          objectType: 'assessment',
          objectId: parsed.data.assessmentId,
          ip: auth.ip,
          userAgent: auth.userAgent,
        });
      }
      return n;
    });
    if (closed === 0) {
      return { ok: false, error: appError('CAMPAGNE_INTROUVABLE', 'Cette campagne n’existe plus — rechargez la page.') };
    }
    revalidateDetail(slug, parsed.data.frameworkId);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_CLOTURE', 'La clôture a échoué — réessayez.')),
    };
  }
}
