// « Mon travail » : ce qui est assigné à une personne dans tous les modules,
// classé par urgence. Règles pures : la requête fournit les éléments, le
// classement et les libellés se décident ici.

export const WORK_KINDS = [
  'action', 'incident', 'nc', 'risque', 'preuve', 'document', 'audit', 'fournisseur', 'controle', 'processus',
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const WORK_KIND_META: Record<WorkKind, { label: string; plural: string; path: string }> = {
  action: { label: 'Action', plural: 'Actions', path: '/plan-action' },
  incident: { label: 'Incident', plural: 'Incidents', path: '/incidents' },
  nc: { label: 'Non-conformité', plural: 'Non-conformités', path: '/non-conformites' },
  risque: { label: 'Risque', plural: 'Risques', path: '/risques' },
  preuve: { label: 'Preuve', plural: 'Preuves', path: '/preuves' },
  document: { label: 'Document', plural: 'Documents', path: '/documents' },
  audit: { label: 'Audit', plural: 'Audits', path: '/audits' },
  fournisseur: { label: 'Fournisseur', plural: 'Fournisseurs', path: '/fournisseurs' },
  controle: { label: 'Contrôle', plural: 'Contrôles', path: '/referentiels' },
  processus: { label: 'Processus', plural: 'Processus', path: '/processus' },
};

export const WORK_URGENCIES = ['en_retard', 'cette_semaine', 'ce_mois', 'plus_tard', 'sans_echeance'] as const;
export type WorkUrgency = (typeof WORK_URGENCIES)[number];

export const WORK_URGENCY_LABEL: Record<WorkUrgency, string> = {
  en_retard: 'En retard',
  cette_semaine: 'Dans les 7 jours',
  ce_mois: 'Dans les 30 jours',
  plus_tard: 'Plus tard',
  sans_echeance: 'Sans échéance',
};

export interface WorkItem {
  kind: WorkKind;
  id: string;
  title: string;
  /** Échéance au format AAAA-MM-JJ, ou null. */
  due: string | null;
  /** Ce qui est attendu (« Revue du risque », « Notification 72 h »…). */
  detail: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

/** Jours restants (négatif si dépassé) entre aujourd'hui et l'échéance. */
export function daysUntil(due: string, today: string): number {
  return Math.round((utcDay(due) - utcDay(today)) / DAY_MS);
}

export function workUrgency(due: string | null, today: string): WorkUrgency {
  if (!due) return 'sans_echeance';
  const days = daysUntil(due, today);
  if (days < 0) return 'en_retard';
  if (days <= 7) return 'cette_semaine';
  if (days <= 30) return 'ce_mois';
  return 'plus_tard';
}

/** « en retard de 3 jours », « aujourd'hui », « demain », « dans 12 jours ». */
export function dueLabel(due: string | null, today: string): string {
  if (!due) return 'Sans échéance';
  const days = daysUntil(due, today);
  if (days < -1) return `En retard de ${-days} jours`;
  if (days === -1) return 'En retard d’un jour';
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  return `Dans ${days} jours`;
}

export interface WorkGroup {
  urgency: WorkUrgency;
  items: WorkItem[];
}

/**
 * Regroupe par urgence (groupes vides omis) ; dans un groupe, l'échéance la
 * plus proche d'abord, puis l'ordre des modules, puis le titre.
 */
export function groupWork(items: readonly WorkItem[], today: string): WorkGroup[] {
  const kindRank = (k: WorkKind) => WORK_KINDS.indexOf(k);
  return WORK_URGENCIES.map((urgency) => ({
    urgency,
    items: items
      .filter((i) => workUrgency(i.due, today) === urgency)
      .sort((a, b) =>
        (a.due ?? '9999').localeCompare(b.due ?? '9999')
        || kindRank(a.kind) - kindRank(b.kind)
        || a.title.localeCompare(b.title, 'fr')),
  })).filter((g) => g.items.length > 0);
}

/** Nombre d'éléments qui demandent une attention immédiate (retard ou 7 jours). */
export function urgentWorkCount(items: readonly WorkItem[], today: string): number {
  return items.filter((i) => {
    const u = workUrgency(i.due, today);
    return u === 'en_retard' || u === 'cette_semaine';
  }).length;
}
