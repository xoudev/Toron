'use server';

import { appError } from '@toron/core';
import {
  acceptRisk,
  createRisk,
  linkRiskControl,
  listRiskControlIds,
  unlinkRiskControl,
  updateRiskDetails,
  updateRiskRating,
  withTenant,
  writeAuditEntry,
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

const Treatment = z.enum(['reduire', 'transferer', 'accepter', 'eviter']);
const Band = z.enum(['faible', 'moyen', 'eleve', 'critique']);
const Level = z.coerce.number().int().min(1).max(6);
const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
  .optional()
  .nullable();

const DetailsShape = {
  title: z.string().trim().min(2, '2 caractères minimum').max(200),
  scopeId: z.uuid(),
  scenario: z.string().trim().max(4000).optional().nullable(),
  businessValue: z.string().trim().max(1000).optional().nullable(),
  treatment: Treatment,
  residualTarget: Band.optional().nullable(),
  ownerUserId: z.uuid().optional().nullable(),
  nextReview: DateStr,
};

const RatingShape = { grossG: Level, grossV: Level, netG: Level, netV: Level };

const CreateSchema = z.object({ ...DetailsShape, ...RatingShape });

export async function createRiskAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ riskId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Risque invalide — un intitulé (2 caractères min), un périmètre et une cotation sont requis.') };
  }
  const d = parsed.data;
  try {
    const riskId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createRisk(tx, {
        tenantId: auth.tenantId,
        scopeId: d.scopeId,
        title: d.title,
        businessValue: d.businessValue ?? null,
        scenario: d.scenario ?? null,
        grossG: d.grossG,
        grossV: d.grossV,
        netG: d.netG,
        netV: d.netV,
        treatment: d.treatment,
        residualTarget: d.residualTarget ?? null,
        ownerUserId: d.ownerUserId ?? null,
        nextReview: d.nextReview ?? null,
        ratedBy: auth.userId,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'risk.create',
        objectType: 'risk',
        objectId: id,
        after: { title: d.title, treatment: d.treatment },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidatePath(`/t/${slug}/risques`);
    return { ok: true, data: { riskId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création du risque a échoué — vérifiez la cotation et réessayez.')) };
  }
}

const SaveDetailsSchema = z.object({ riskId: z.uuid(), ...DetailsShape });

export async function saveRiskDetailsAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SaveDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Modifications invalides — vérifiez les champs.') };
  }
  const d = parsed.data;
  try {
    const affected = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const n = await updateRiskDetails(tx, {
        riskId: d.riskId,
        title: d.title,
        businessValue: d.businessValue ?? null,
        scenario: d.scenario ?? null,
        treatment: d.treatment,
        residualTarget: d.residualTarget ?? null,
        ownerUserId: d.ownerUserId ?? null,
        nextReview: d.nextReview ?? null,
      });
      if (n > 0) {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'risk.update',
          objectType: 'risk',
          objectId: d.riskId,
          after: { treatment: d.treatment },
          ip: auth.ip,
          userAgent: auth.userAgent,
        });
      }
      return n;
    });
    if (affected === 0) {
      return { ok: false, error: appError('RISQUE_INTROUVABLE', 'Ce risque n’existe plus — rechargez la page.') };
    }
    revalidatePath(`/t/${slug}/risques`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour a échoué — réessayez.')) };
  }
}

const RateSchema = z.object({ riskId: z.uuid(), ...RatingShape });

export async function rateRiskAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = RateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Cotation invalide — gravité et vraisemblance attendues.') };
  }
  const d = parsed.data;
  try {
    const affected = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const n = await updateRiskRating(tx, {
        riskId: d.riskId,
        tenantId: auth.tenantId,
        grossG: d.grossG,
        grossV: d.grossV,
        netG: d.netG,
        netV: d.netV,
        ratedBy: auth.userId,
      });
      if (n > 0) {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'risk.rate',
          objectType: 'risk',
          objectId: d.riskId,
          after: { net: `${d.netG}x${d.netV}` },
          ip: auth.ip,
          userAgent: auth.userAgent,
        });
      }
      return n;
    });
    if (affected === 0) {
      return { ok: false, error: appError('RISQUE_INTROUVABLE', 'Ce risque n’existe plus — rechargez la page.') };
    }
    revalidatePath(`/t/${slug}/risques`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_COTATION', 'La cotation a échoué — vérifiez qu’elle tient dans l’échelle active.')) };
  }
}

const AcceptSchema = z.object({
  riskId: z.uuid(),
  rationale: z.string().trim().min(10, 'Motivez l’acceptation (10 caractères min).').max(4000),
  expiresAt: DateStr,
});

export async function acceptRiskAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = AcceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Acceptation invalide — une motivation d’au moins 10 caractères est requise.') };
  }
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await acceptRisk(tx, {
        tenantId: auth.tenantId,
        riskId: d.riskId,
        acceptedByUser: auth.userId,
        rationale: d.rationale,
        expiresAt: d.expiresAt ?? null,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'risk.accept',
        objectType: 'risk_acceptance',
        objectId: id,
        after: { riskId: d.riskId, expiresAt: d.expiresAt ?? null },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/risques`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ACCEPTATION', 'L’enregistrement de l’acceptation a échoué — réessayez.')) };
  }
}

const ToggleSchema = z.object({ riskId: z.uuid(), controlId: z.uuid(), linked: z.boolean() });

export async function toggleRiskControlAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide — rechargez la page.') };
  }
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (d.linked) {
        await linkRiskControl(tx, { tenantId: auth.tenantId, riskId: d.riskId, controlId: d.controlId });
      } else {
        await unlinkRiskControl(tx, { riskId: d.riskId, controlId: d.controlId });
      }
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: d.linked ? 'risk.control_link' : 'risk.control_unlink',
        objectType: 'risk_control',
        objectId: d.riskId,
        after: { controlId: d.controlId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/risques`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LIAISON', 'La liaison du contrôle a échoué — réessayez.')) };
  }
}

export async function getRiskControlsAction(
  slug: string,
  riskId: string,
): Promise<ActionResult<{ controlIds: string[] }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(riskId);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de risque invalide.') };
  }
  try {
    const controlIds = await withTenant(appDb().db, auth.tenantId, (tx) =>
      listRiskControlIds(tx, parsed.data),
    );
    return { ok: true, data: { controlIds } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture des contrôles a échoué — réessayez.')) };
  }
}
