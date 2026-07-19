'use server';

import { appError } from '@toron/core';
import { createSupplier, updateSupplier, withTenant, writeAuditEntry } from '@toron/db';
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

const Tier = z.enum(['t1', 't2', 't3']);
const Contract = z.enum(['a_faire', 'en_cours', 'conforme']);
const Shape = {
  name: z.string().trim().min(2).max(200),
  tier: Tier,
  services: z.string().trim().max(2000).optional().nullable(),
  dataCategories: z.array(z.string().trim().max(120)).max(20).optional(),
  contractStatus: Contract,
  ownerUserId: z.uuid().optional().nullable(),
  nextReview: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
};

export async function createSupplierAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object(Shape).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Fournisseur invalide — un nom et un niveau sont requis.') };
  const d = parsed.data;
  try {
    const id = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const sid = await createSupplier(tx, { tenantId: auth.tenantId, name: d.name, tier: d.tier, services: d.services ?? null, dataCategories: d.dataCategories ?? [], contractStatus: d.contractStatus, ownerUserId: d.ownerUserId ?? null, nextReview: d.nextReview ?? null });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'supplier.create', objectType: 'supplier', objectId: sid, after: { name: d.name, tier: d.tier }, ip: auth.ip, userAgent: auth.userAgent });
      return sid;
    });
    revalidatePath(`/t/${slug}/fournisseurs`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création du fournisseur a échoué — réessayez.')) };
  }
}

export async function updateSupplierAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ supplierId: z.uuid(), ...Shape }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Modifications invalides.') };
  const d = parsed.data;
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await updateSupplier(tx, { supplierId: d.supplierId, name: d.name, tier: d.tier, services: d.services ?? null, dataCategories: d.dataCategories ?? [], contractStatus: d.contractStatus, ownerUserId: d.ownerUserId ?? null, nextReview: d.nextReview ?? null });
      if (affected > 0) await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'supplier.update', objectType: 'supplier', objectId: d.supplierId, after: { contractStatus: d.contractStatus }, ip: auth.ip, userAgent: auth.userAgent });
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('INTROUVABLE', 'Ce fournisseur n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}/fournisseurs`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'La mise à jour a échoué — réessayez.')) };
  }
}
