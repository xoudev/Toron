'use server';

import {
  appError,
  ASSESSMENT_ITEM_STATUSES,
  exclusionAllowed,
  isSoaItemValid,
  normalizeSoaItem,
  recyfPreExclusions,
  suggestInheritedStatuses,
  type StatusSuggestion,
} from '@toron/core';
import {
  closeAssessment,
  createAction,
  createAssessment,
  createExport,
  findGapAction,
  getAssessmentItemContext,
  getFramework,
  getMutualizedPeers,
  setAssessmentItemStatus,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { recyf } from '@toron/frameworks';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { authorizeManager, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';

function revalidateDetail(slug: string, frameworkId: string) {
  revalidatePath(`/t/${slug}/referentiels/${frameworkId}`, 'page');
  revalidatePath(`/t/${slug}/referentiels`, 'layout');
}

/**
 * CA §5.5 : convertir un écart d'évaluation en action corrective en 1 clic.
 * L'action est pré-liée à sa campagne (origine) et à l'exigence concernée —
 * la conversion ne perd jamais la traçabilité (RM §5.5). Un écart enregistré
 * ne produit qu'une action : si elle existe déjà, on la renvoie.
 */
export async function createActionFromGapAction(
  slug: string,
  input: { assessmentId: string; requirementId: string; requirementRef: string; requirementTitle: string },
): Promise<ActionResult<{ actionId: string; existing: boolean }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      assessmentId: z.uuid(),
      requirementId: z.uuid(),
      requirementRef: z.string().trim().min(1).max(40),
      requirementTitle: z.string().trim().min(1).max(300),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Écart invalide — rechargez la page et réessayez.') };
  }
  const d = parsed.data;
  try {
    const result = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const item = await getAssessmentItemContext(tx, d.assessmentId, d.requirementId);
      if (!item || item.status !== 'ecart') return { outcome: 'not_gap' as const };
      const existing = await findGapAction(tx, d.assessmentId, d.requirementId);
      if (existing) return { outcome: 'existing' as const, actionId: existing };
      const id = await createAction(tx, {
        tenantId: auth.tenantId,
        title: `Corriger l’écart — ${d.requirementRef} ${d.requirementTitle}`.slice(0, 200),
        description: `Action corrective ouverte depuis l’évaluation pour l’exigence ${d.requirementRef}.`,
        originType: 'assessment',
        originId: d.assessmentId,
        ownerUserId: auth.userId,
        priority: 'p2',
        links: [{ targetType: 'requirement', targetId: d.requirementId }],
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'action.create_from_gap',
        objectType: 'action',
        objectId: id,
        after: { requirementRef: d.requirementRef, assessmentId: d.assessmentId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { outcome: 'created' as const, actionId: id };
    });
    if (result.outcome === 'not_gap') {
      return {
        ok: false,
        error: appError('ECART_NON_ENREGISTRE', 'Cette exigence n’est pas enregistrée en écart — enregistrez d’abord le statut « Écart », puis créez l’action.'),
      };
    }
    if (result.outcome === 'created') revalidatePath(`/t/${slug}/plan-action`);
    return { ok: true, data: { actionId: result.actionId, existing: result.outcome === 'existing' } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création de l’action a échoué — réessayez.')) };
  }
}

export async function createAssessmentAction(
  slug: string,
  input: { frameworkId: string; scopeId: string; campaignLabel: string; nis2Entity?: string },
): Promise<ActionResult<{ assessmentId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      frameworkId: z.uuid(),
      scopeId: z.uuid(),
      campaignLabel: z.string().trim().min(2, '2 caractères minimum').max(160),
      nis2Entity: z.enum(['ei', 'ee']).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Campagne invalide — choisissez un périmètre et un intitulé.') };
  }
  const d = parsed.data;
  try {
    const result = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const fw = await getFramework(tx, d.frameworkId);
      if (!fw) return { outcome: 'not_found' as const };
      // ReCyF : la catégorie d'entité décide des moyens qui la concernent ;
      // ceux réservés à l'autre catégorie entrent déjà exclus et justifiés.
      let excluded: { refs: string[]; justification: string } | undefined;
      if (fw.code === 'recyf') {
        if (!d.nis2Entity) return { outcome: 'entity_required' as const };
        const data = recyf();
        excluded = recyfPreExclusions(data.objectives.flatMap((o) => o.means), d.nis2Entity, data.version);
      }
      const id = await createAssessment(tx, {
        tenantId: auth.tenantId,
        frameworkId: d.frameworkId,
        scopeId: d.scopeId,
        campaignLabel: d.campaignLabel,
        excluded,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'assessment.create',
        objectType: 'assessment',
        objectId: id,
        after: excluded
          ? { campaignLabel: d.campaignLabel, nis2Entity: d.nis2Entity, preExcluded: excluded.refs.length }
          : { campaignLabel: d.campaignLabel },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { outcome: 'created' as const, id };
    });
    if (result.outcome === 'not_found') {
      return { ok: false, error: appError('REFERENTIEL_INTROUVABLE', 'Ce référentiel n’existe plus — rechargez la page.') };
    }
    if (result.outcome === 'entity_required') {
      return {
        ok: false,
        error: appError('ENTITE_NIS2_REQUISE', 'Précisez si l’organisation est une entité importante ou essentielle, puis relancez.'),
      };
    }
    revalidateDetail(slug, d.frameworkId);
    return { ok: true, data: { assessmentId: result.id } };
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
  // Inclusion dans la SoA et justification se déduisent du statut, pas du client.
  const soa = normalizeSoaItem(parsed.data.status, parsed.data.soaJustification);
  try {
    const outcome = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const item = await getAssessmentItemContext(tx, parsed.data.assessmentId, parsed.data.requirementId);
      if (!item) return 'not_found' as const;
      if (item.campaignStatus === 'cloturee') return 'closed' as const;
      if (parsed.data.status === 'non_applicable' && !exclusionAllowed(item.frameworkCode, item.requirementRef)) {
        return 'not_excludable' as const;
      }
      const n = await setAssessmentItemStatus(tx, {
        assessmentId: parsed.data.assessmentId,
        requirementId: parsed.data.requirementId,
        status: parsed.data.status,
        statement: parsed.data.statement ?? null,
        soaIncluded: soa.soaIncluded,
        soaJustification: soa.soaJustification,
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
      return n > 0 ? ('updated' as const) : ('not_found' as const);
    });
    if (outcome === 'not_found') {
      return { ok: false, error: appError('ITEM_INTROUVABLE', 'Cette exigence n’est pas dans la campagne — rechargez la page.') };
    }
    if (outcome === 'closed') {
      return {
        ok: false,
        error: appError('CAMPAGNE_CLOTUREE', 'Cette campagne est clôturée, ses statuts sont figés — ouvrez une nouvelle campagne pour réévaluer.'),
      };
    }
    if (outcome === 'not_excludable') {
      return {
        ok: false,
        error: appError('EXCLUSION_INTERDITE', 'Les clauses 4 à 10 d’ISO 27001 ne peuvent pas être exclues ; seules les mesures de l’Annexe A le peuvent — choisissez un autre statut.'),
      };
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
 * Demande l'export scellé de la Déclaration d'applicabilité : crée un export
 * « en cours » que le worker Typst compilera et scellera (ADR-5/6). Le
 * poinçon (empreinte + slug) est posé par le worker.
 */
export async function requestSoaExportAction(
  slug: string,
  input: { frameworkId: string; assessmentId: string },
): Promise<ActionResult<{ exportId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ frameworkId: z.uuid(), assessmentId: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de campagne invalide.') };
  }
  try {
    const exportId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createExport(tx, {
        tenantId: auth.tenantId,
        type: 'soa',
        objectRef: parsed.data.assessmentId,
        requestedBy: auth.userId,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'export.request',
        objectType: 'export',
        objectId: id,
        after: { type: 'soa', assessmentId: parsed.data.assessmentId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidateDetail(slug, parsed.data.frameworkId);
    return { ok: true, data: { exportId } };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_EXPORT', 'La demande d’export a échoué — réessayez.')),
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
