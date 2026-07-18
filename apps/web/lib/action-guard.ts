import 'server-only';

import { appError, canManageControls, type AppError } from '@toron/core';
import { headers } from 'next/headers';

import { getTenantContext } from './tenant-context-cache.ts';

// Garde commune des server actions du produit (S4/S5) : contexte tenant
// re-résolu côté serveur (le layout ne protège pas les actions), RBAC,
// normalisation de l'IP source, journalisation corrélée des échecs.

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export interface Authorized {
  tenantId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}

export function isActionError(v: Authorized | AppError): v is AppError {
  return 'code' in v;
}

/**
 * Autorise une mutation : tenant courant + rôle habilité à gérer la
 * conformité (canManageControls ; lecteur/auditeur en lecture seule). Le
 * tenantId renvoyé provient TOUJOURS d'ici, jamais du formulaire.
 */
export async function authorizeManager(slug: string): Promise<Authorized | AppError> {
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
      'Votre rôle est en lecture seule — demandez à un RSSI ou responsable qualité d’effectuer cette action.',
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

/**
 * Ne conserve le premier hop de X-Forwarded-For que s'il ressemble à une IP,
 * sinon undefined : évite d'insérer une valeur arbitraire/invalide dans
 * audit_log.ip (type inet), qui annulerait la transaction métier.
 */
export function normalizeIp(raw: string | null): string | undefined {
  const first = raw?.split(',')[0]?.trim();
  if (!first) return undefined;
  const isIpv4 =
    /^(\d{1,3}\.){3}\d{1,3}$/.test(first) && first.split('.').every((o) => Number(o) <= 255);
  const isIpv6 = first.includes(':') && /^[0-9a-fA-F:.]+$/.test(first);
  return isIpv4 || isIpv6 ? first : undefined;
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
