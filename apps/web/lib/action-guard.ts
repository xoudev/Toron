import 'server-only';

import { appError, canManageControls, normalizeIp, type AppError, type MembershipRole } from '@toron/core';
import { headers } from 'next/headers';

import { getTenantContext } from './tenant-context-cache.ts';

// Garde commune des server actions du produit (S4/S5) : contexte tenant
// re-résolu côté serveur (le layout ne protège pas les actions), RBAC,
// normalisation de l'IP source, journalisation corrélée des échecs.

// normalizeIp vit dans @toron/core (l'authentification s'en sert aussi) ;
// réexportée pour les appelants existants.
export { normalizeIp };

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export interface Authorized {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  ip?: string;
  userAgent?: string;
}

export function isActionError(v: Authorized | AppError): v is AppError {
  return 'code' in v;
}

/**
 * Autorise une mutation pour tout rôle qui satisfait `allowed`. Le tenantId
 * renvoyé provient TOUJOURS d'ici, jamais du formulaire.
 */
export async function authorizeRole(
  slug: string,
  allowed: (role: MembershipRole) => boolean,
  refusal: string,
): Promise<Authorized | AppError> {
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') {
    return appError(
      'ACCES_REFUSE',
      'Accès refusé — reconnectez-vous, puis réessayez depuis votre organisation.',
    );
  }
  if (!allowed(ctx.role)) return appError('ROLE_INSUFFISANT', refusal);
  const h = await headers();
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    role: ctx.role,
    ip: normalizeIp(h.get('x-forwarded-for')),
    userAgent: h.get('user-agent') || undefined,
  };
}

/**
 * Autorise une mutation : tenant courant + rôle habilité à gérer la
 * conformité (canManageControls ; lecteur/auditeur en lecture seule).
 */
export function authorizeManager(slug: string): Promise<Authorized | AppError> {
  return authorizeRole(
    slug,
    canManageControls,
    'Votre rôle est en lecture seule — demandez à un RSSI ou responsable qualité d’effectuer cette action.',
  );
}

/**
 * Journalise l'échec d'une action côté serveur, corrélé par correlationId
 * (chaîne de format littérale — pas d'interpolation dans le format, S4/§13).
 */
export function logFailure(err: unknown, error: AppError): AppError {
  console.error('[toron] échec d’action', {
    correlationId: error.correlationId,
    code: error.code,
    cause: err instanceof Error ? err.message : String(err),
  });
  return error;
}
