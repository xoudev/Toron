import { auditLog } from './schema/tenancy.js';
import type { TenantTx } from './tenant.js';

/**
 * Entrée du journal d'audit (S6, §8.2). `before`/`after` reçoivent des
 * instantanés d'objets métier : jamais de secret, de PII inutile ni de
 * contenu de preuve (S4/§13) — la responsabilité du filtrage est à
 * l'appelant, au plus près du métier.
 */
export interface AuditEntry {
  tenantId: string;
  action: string;
  objectType: string;
  objectId?: string;
  actorUserId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

/**
 * Écrit une entrée d'audit DANS la transaction métier courante : si la
 * mutation est annulée, l'entrée l'est aussi — le journal ne raconte que
 * ce qui a réellement eu lieu.
 */
export async function writeAuditEntry(tx: TenantTx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId,
    actorUserId: entry.actorUserId,
    before: entry.before,
    after: entry.after,
    ip: entry.ip,
    userAgent: entry.userAgent,
  });
}
