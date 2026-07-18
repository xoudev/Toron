'use server';

import { appError, parseAssetsCsv } from '@toron/core';
import {
  bulkCreateAssets,
  createAsset,
  linkAssetRisk,
  listAssetRiskIds,
  unlinkAssetRisk,
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

const Category = z.enum(['materiel', 'logiciel', 'donnees', 'flux']);
const Axis = z.coerce.number().int().min(1).max(4);

const CreateSchema = z.object({
  name: z.string().trim().min(2, '2 caractères minimum').max(200),
  category: Category,
  description: z.string().trim().max(2000).optional().nullable(),
  scopeId: z.uuid().optional().nullable(),
  dicpD: Axis,
  dicpI: Axis,
  dicpC: Axis,
  dicpP: Axis,
});

export async function createAssetAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Actif invalide — intitulé, catégorie et cotation DICP (1-4) requis.') };
  }
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createAsset(tx, {
        tenantId: auth.tenantId,
        name: d.name,
        category: d.category,
        description: d.description ?? null,
        scopeId: d.scopeId ?? null,
        dicpD: d.dicpD,
        dicpI: d.dicpI,
        dicpC: d.dicpC,
        dicpP: d.dicpP,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'asset.create',
        objectType: 'asset',
        objectId: id,
        after: { name: d.name, category: d.category },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/actifs`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création de l’actif a échoué — réessayez.')) };
  }
}

const ImportSchema = z.object({ csv: z.string().min(1).max(1_000_000) });

/** Import CSV : parse (cœur) puis insère en lot. Renvoie le nombre importé et les erreurs. */
export async function importAssetsCsvAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ imported: number; errors: string[] }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ImportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Collez le contenu CSV à importer.') };
  }
  const { rows, errors } = parseAssetsCsv(parsed.data.csv);
  if (rows.length === 0) {
    return { ok: false, error: appError('CSV_VIDE', errors[0] ?? 'Aucune ligne valide à importer.') };
  }
  try {
    const imported = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const n = await bulkCreateAssets(tx, auth.tenantId, rows);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'asset.import_csv',
        objectType: 'asset',
        after: { imported: n, skipped: errors.length },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return n;
    });
    revalidatePath(`/t/${slug}/actifs`);
    return { ok: true, data: { imported, errors } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_IMPORT', 'L’import a échoué — réessayez.')) };
  }
}

const ToggleSchema = z.object({ assetId: z.uuid(), riskId: z.uuid(), linked: z.boolean() });

export async function toggleAssetRiskAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (d.linked) {
        await linkAssetRisk(tx, { tenantId: auth.tenantId, assetId: d.assetId, riskId: d.riskId });
      } else {
        await unlinkAssetRisk(tx, { assetId: d.assetId, riskId: d.riskId });
      }
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: d.linked ? 'asset.link_risk' : 'asset.unlink_risk',
        objectType: 'asset',
        objectId: d.assetId,
        after: { riskId: d.riskId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/actifs`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LIAISON', 'La liaison au risque a échoué — réessayez.')) };
  }
}

export async function getAssetRisksAction(
  slug: string,
  assetId: string,
): Promise<ActionResult<{ riskIds: string[] }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(assetId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const riskIds = await withTenant(appDb().db, auth.tenantId, (tx) => listAssetRiskIds(tx, parsed.data));
    return { ok: true, data: { riskIds } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué — réessayez.')) };
  }
}
