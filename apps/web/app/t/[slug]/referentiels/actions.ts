'use server';

import {
  appError,
  canManageControls,
  type AppError,
  type ControlDeleteImpact,
} from '@toron/core';
import {
  activateFrameworkOnScope,
  addCustomRequirement,
  createControl,
  createCustomFramework,
  deleteControl,
  getControlDeleteImpact,
  getFramework,
  mapControlToRequirement,
  unmapControlFromRequirement,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

// Résultat uniforme des actions : jamais de stack au client (S4), message
// utilisateur en français avec cause + correction.
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

interface Authorized {
  tenantId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Garde commune : contexte tenant re-résolu côté serveur (le layout ne
 * protège pas les actions — points d'entrée distincts), puis RBAC. Le
 * tenantId provient TOUJOURS d'ici, jamais du formulaire (RLS WITH CHECK).
 */
async function authorize(slug: string): Promise<Authorized | AppError> {
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') {
    return appError(
      'ACCES_REFUSE',
      'Accès refusé — reconnectez-vous, puis réessayez depuis votre organisation.',
    );
  }
  if (!canManageControls(ctx.role)) {
    return appError(
      'ROLE_INSUFFISANT',
      'Votre rôle est en lecture seule sur les contrôles — demandez à un RSSI ou responsable qualité d’effectuer cette action.',
    );
  }
  const h = await headers();
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    ip: normalizeIp(h.get('x-forwarded-for')),
    userAgent: h.get('user-agent') || undefined,
  };
}

function isError(v: Authorized | AppError): v is AppError {
  return 'code' in v;
}

/**
 * Normalise l'adresse source (en-tête proxy) : ne conserve que le premier
 * hop s'il est une adresse IP plausible, sinon `undefined`. Évite d'insérer
 * une valeur arbitraire ou invalide dans audit_log.ip (type inet) — qui,
 * mal formée, annulerait la transaction métier.
 */
function normalizeIp(raw: string | null): string | undefined {
  const first = raw?.split(',')[0]?.trim();
  if (!first) return undefined;
  const isIpv4 =
    /^(\d{1,3}\.){3}\d{1,3}$/.test(first) && first.split('.').every((o) => Number(o) <= 255);
  const isIpv6 = first.includes(':') && /^[0-9a-fA-F:.]+$/.test(first);
  return isIpv4 || isIpv6 ? first : undefined;
}

/**
 * Journalise côté serveur l'échec d'une action, corrélé par correlationId
 * (celui renvoyé au client) — sans PII, secret ni contenu de preuve (§13).
 * Le support peut relier un correlationId utilisateur à une trace serveur.
 */
function logFailure(err: unknown, error: AppError): AppError {
  console.error(
    `[${error.correlationId}] ${error.code}`,
    err instanceof Error ? err.message : String(err),
  );
  return error;
}

const UuidSchema = z.object({ controlId: z.uuid(), requirementId: z.uuid() });

export async function createControlAction(
  slug: string,
  input: { title: string; description?: string; requirementId?: string },
): Promise<ActionResult<{ controlId: string }>> {
  const auth = await authorize(slug);
  if (isError(auth)) return { ok: false, error: auth };

  const parsed = z
    .object({
      title: z.string().trim().min(2, '2 caractères minimum').max(200),
      description: z.string().trim().max(2000).optional(),
      requirementId: z.uuid().optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: appError('SAISIE_INVALIDE', 'Intitulé de contrôle invalide — 2 à 200 caractères attendus.'),
    };
  }

  try {
    const controlId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createControl(tx, {
        tenantId: auth.tenantId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      });
      if (parsed.data.requirementId) {
        await mapControlToRequirement(tx, auth.tenantId, id, parsed.data.requirementId);
      }
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'control.create',
        objectType: 'control',
        objectId: id,
        after: { title: parsed.data.title },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidatePath(`/t/${slug}/referentiels`, 'layout');
    return { ok: true, data: { controlId } };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_CREATION', 'La création du contrôle a échoué — réessayez dans un instant.')),
    };
  }
}

export async function mapControlAction(
  slug: string,
  input: { controlId: string; requirementId: string },
): Promise<ActionResult> {
  const auth = await authorize(slug);
  if (isError(auth)) return { ok: false, error: auth };
  const parsed = UuidSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Références invalides — rechargez la page et réessayez.') };
  }
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      await mapControlToRequirement(tx, auth.tenantId, parsed.data.controlId, parsed.data.requirementId);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'control.map',
        objectType: 'control_requirement',
        objectId: parsed.data.controlId,
        after: { requirementId: parsed.data.requirementId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/referentiels`, 'layout');
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_MAPPING', 'Le rattachement a échoué — vérifiez que le contrôle et l’exigence existent toujours.')),
    };
  }
}

export async function unmapControlAction(
  slug: string,
  input: { controlId: string; requirementId: string },
): Promise<ActionResult> {
  const auth = await authorize(slug);
  if (isError(auth)) return { ok: false, error: auth };
  const parsed = UuidSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Références invalides — rechargez la page et réessayez.') };
  }
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      await unmapControlFromRequirement(tx, parsed.data.controlId, parsed.data.requirementId);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'control.unmap',
        objectType: 'control_requirement',
        objectId: parsed.data.controlId,
        before: { requirementId: parsed.data.requirementId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/referentiels`, 'layout');
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_DEMAPPING', 'Le retrait du mapping a échoué — réessayez.')),
    };
  }
}

/** Lecture seule : alimente le dialogue de confirmation AVANT suppression (RM §5.2). */
export async function getControlDeleteImpactAction(
  slug: string,
  controlId: string,
): Promise<ActionResult<ControlDeleteImpact>> {
  const auth = await authorize(slug);
  if (isError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(controlId);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de contrôle invalide.') };
  }
  try {
    const impact = await withTenant(appDb().db, auth.tenantId, (tx) =>
      getControlDeleteImpact(tx, parsed.data),
    );
    return { ok: true, data: impact };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_ANALYSE_IMPACT', 'L’analyse de l’impact a échoué — réessayez.')),
    };
  }
}

export async function deleteControlAction(
  slug: string,
  input: { controlId: string; confirmed: boolean },
): Promise<ActionResult> {
  const auth = await authorize(slug);
  if (isError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({ controlId: z.uuid(), confirmed: z.boolean() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de contrôle invalide.') };
  }
  try {
    const result = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      // Recalcul de l'impact côté serveur : une confirmation cliente ne
      // suffit pas, le serveur re-vérifie (RM §5.2, S5).
      const impact = await getControlDeleteImpact(tx, parsed.data.controlId);
      if (impact.requiresConfirmation && !parsed.data.confirmed) {
        return { outcome: 'blocked' as const };
      }
      const removed = await deleteControl(tx, parsed.data.controlId);
      // 0 ligne : id inconnu ou hors tenant (RLS) — ne pas journaliser une
      // suppression fantôme dans audit_log (append-only), ne pas mentir au client.
      if (removed === 0) {
        return { outcome: 'not_found' as const };
      }
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'control.delete',
        objectType: 'control',
        objectId: parsed.data.controlId,
        before: { mappedRequirementCount: impact.mappedRequirementCount },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { outcome: 'deleted' as const };
    });
    if (result.outcome === 'blocked') {
      return { ok: false, error: appError('CONFIRMATION_REQUISE', 'Confirmation requise — ce contrôle couvre des exigences.') };
    }
    if (result.outcome === 'not_found') {
      return { ok: false, error: appError('CONTROLE_INTROUVABLE', 'Ce contrôle n’existe plus — rechargez la page.') };
    }
    revalidatePath(`/t/${slug}/referentiels`, 'layout');
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_SUPPRESSION', 'La suppression a échoué — réessayez.')),
    };
  }
}

export async function activateFrameworkAction(
  slug: string,
  input: { frameworkId: string; scopeId: string },
): Promise<ActionResult> {
  const auth = await authorize(slug);
  if (isError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({ frameworkId: z.uuid(), scopeId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Sélection invalide — choisissez un périmètre.') };
  }
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      await activateFrameworkOnScope(tx, auth.tenantId, parsed.data.scopeId, parsed.data.frameworkId);
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'framework.activate',
        objectType: 'scope_framework',
        objectId: parsed.data.frameworkId,
        after: { scopeId: parsed.data.scopeId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/referentiels`, 'layout');
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_ACTIVATION', 'L’activation a échoué — réessayez.')),
    };
  }
}

export async function createCustomFrameworkAction(
  slug: string,
  input: { code: string; version: string; name: string },
): Promise<ActionResult<{ frameworkId: string }>> {
  const auth = await authorize(slug);
  if (isError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      code: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, 'minuscules, chiffres et _ uniquement'),
      version: z.string().trim().min(1).max(40),
      name: z.string().trim().min(2).max(160),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: appError('SAISIE_INVALIDE', 'Référentiel invalide — code (minuscules/chiffres/_), version et nom sont requis.'),
    };
  }
  try {
    const frameworkId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createCustomFramework(tx, {
        tenantId: auth.tenantId,
        code: parsed.data.code,
        version: parsed.data.version,
        name: parsed.data.name,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'framework.create_custom',
        objectType: 'framework',
        objectId: id,
        after: { code: parsed.data.code, name: parsed.data.name },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidatePath(`/t/${slug}/referentiels`, 'layout');
    return { ok: true, data: { frameworkId } };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_CREATION', 'La création du référentiel a échoué — le code existe peut-être déjà.')),
    };
  }
}

export async function addCustomRequirementAction(
  slug: string,
  input: { frameworkId: string; ref: string; title: string; guidance?: string },
): Promise<ActionResult<{ requirementId: string }>> {
  const auth = await authorize(slug);
  if (isError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({
      frameworkId: z.uuid(),
      ref: z.string().trim().min(1).max(40),
      title: z.string().trim().min(2).max(300),
      guidance: z.string().trim().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Exigence invalide — un identifiant et un intitulé (2 caractères min) sont requis.') };
  }
  try {
    const result = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      // Référentiels builtin immuables (P4) : refuser AVANT écriture.
      const fw = await getFramework(tx, parsed.data.frameworkId);
      if (!fw || fw.isBuiltin) {
        return { blocked: true as const };
      }
      const id = await addCustomRequirement(tx, {
        tenantId: auth.tenantId,
        frameworkId: parsed.data.frameworkId,
        ref: parsed.data.ref,
        title: parsed.data.title,
        guidance: parsed.data.guidance ?? null,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'requirement.create_custom',
        objectType: 'requirement',
        objectId: id,
        after: { ref: parsed.data.ref },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return { blocked: false as const, id };
    });
    if (result.blocked) {
      return { ok: false, error: appError('REFERENTIEL_IMMUABLE', 'Ce référentiel ne peut pas être modifié — seuls vos référentiels internes acceptent de nouvelles exigences.') };
    }
    revalidatePath(`/t/${slug}/referentiels/${parsed.data.frameworkId}`, 'page');
    revalidatePath(`/t/${slug}/referentiels`, 'layout');
    return { ok: true, data: { requirementId: result.id } };
  } catch (err) {
    return {
      ok: false,
      error: logFailure(err, appError('ECHEC_CREATION', 'L’ajout de l’exigence a échoué — réessayez.')),
    };
  }
}
