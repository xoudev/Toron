/**
 * Règles métier des audits internes (module 5.8). Pures et testées.
 * RM §5.8 / S5 : séparation des tâches — l'auditeur affecté ne peut pas être
 * l'un des audités (on ne s'auto-audite pas).
 */

export const AUDIT_STATUSES = ['planifie', 'en_cours', 'clos'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const FINDING_TYPES = ['conforme', 'observation', 'nc_mineure', 'nc_majeure'] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

/** true si l'affectation respecte la séparation des tâches (auditeur ∉ audités). */
export function auditorSeparationOk(
  auditorUserId: string,
  auditeeUserIds: readonly string[],
): boolean {
  return !auditeeUserIds.includes(auditorUserId);
}

/** Un constat exige-t-il une action corrective ? (les non-conformités). */
export function findingRequiresAction(type: FindingType): boolean {
  return type === 'nc_mineure' || type === 'nc_majeure';
}
