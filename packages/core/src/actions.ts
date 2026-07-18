/**
 * Règles métier du plan d'action unifié (module 5.5). Pures et testées.
 * P2 : un seul moteur d'actions pour toutes les origines.
 */

/** Statuts STOCKÉS d'une action (« en_retard » n'en fait pas partie). */
export const ACTION_STATUSES = ['planifie', 'en_cours', 'termine', 'verification'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Statut EFFECTIF affiché : ajoute « en_retard », dérivé de l'échéance. */
export const ACTION_EFFECTIVE_STATUSES = [
  'planifie',
  'en_cours',
  'en_retard',
  'termine',
  'verification',
] as const;
export type ActionEffectiveStatus = (typeof ACTION_EFFECTIVE_STATUSES)[number];

export const ACTION_PRIORITIES = ['p1', 'p2', 'p3'] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export const ACTION_ORIGINS = [
  'risk',
  'finding',
  'incident',
  'nc',
  'assessment',
  'review',
  'manual',
] as const;
export type ActionOrigin = (typeof ACTION_ORIGINS)[number];

/** Colonnes du kanban, dans l'ordre du flux. */
export const KANBAN_COLUMNS: readonly ActionEffectiveStatus[] = [
  'planifie',
  'en_cours',
  'en_retard',
  'verification',
  'termine',
] as const;

function toDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Une action est EN RETARD si son échéance est passée et qu'elle n'est ni
 * terminée ni en vérification. Le retard est CALCULÉ, jamais saisi (RM §5.5).
 */
export function isOverdue(
  action: { status: ActionStatus; dueDate: Date | null },
  today: Date,
): boolean {
  if (action.status === 'termine' || action.status === 'verification') return false;
  if (!action.dueDate) return false;
  return toDay(action.dueDate) < toDay(today);
}

/** Statut effectif d'une action (stocké + « en_retard » dérivé). */
export function effectiveActionStatus(
  action: { status: ActionStatus; dueDate: Date | null },
  today: Date,
): ActionEffectiveStatus {
  return isOverdue(action, today) ? 'en_retard' : action.status;
}

export interface SubtaskProgress {
  done: number;
  total: number;
  /** done / total en pourcentage arrondi ; null si aucune sous-tâche. */
  pct: number | null;
}

/** Avancement d'une action d'après ses sous-tâches. */
export function subtaskProgress(subtasks: readonly { done: boolean }[]): SubtaskProgress {
  const total = subtasks.length;
  const done = subtasks.filter((s) => s.done).length;
  return { done, total, pct: total === 0 ? null : Math.round((done / total) * 100) };
}
