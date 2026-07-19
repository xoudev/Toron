/**
 * Règles métier des incidents & chronologie réglementaire NIS 2 (module 6.1).
 * Pures et testées. RM §6.1 : les échéances se calculent à l'horodatage de
 * QUALIFICATION (jamais d'ouverture) ; clôture interdite sans REX si important.
 */

export const INCIDENT_SEVERITIES = ['mineur', 'majeur', 'critique'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ['ouvert', 'qualifie', 'clos'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const NOTIF_KINDS = ['alerte_24h', 'notification_72h', 'rapport_30j', 'cnil_72h'] as const;
export type NotifKind = (typeof NOTIF_KINDS)[number];

/** Décalages réglementaires depuis la qualification, en heures. */
const NIS2_OFFSETS_H: Record<Exclude<NotifKind, 'cnil_72h'>, number> = {
  alerte_24h: 24,
  notification_72h: 72,
  rapport_30j: 24 * 30,
};
const CNIL_OFFSET_H = 72;

export interface DeadlinePlan {
  kind: NotifKind;
  dueAt: Date;
}

/**
 * Échéancier NIS 2 à partir de l'horodatage de qualification (RM §6.1) :
 * alerte 24 h, notification 72 h, rapport J+30 ; + volet RGPD CNIL 72 h si
 * une violation de données personnelles est concernée.
 */
export function nis2Deadlines(qualifiedAt: Date, gdprBreach: boolean): DeadlinePlan[] {
  const base = qualifiedAt.getTime();
  const plans: DeadlinePlan[] = (Object.keys(NIS2_OFFSETS_H) as (keyof typeof NIS2_OFFSETS_H)[]).map(
    (kind) => ({ kind, dueAt: new Date(base + NIS2_OFFSETS_H[kind] * 3_600_000) }),
  );
  if (gdprBreach) plans.push({ kind: 'cnil_72h', dueAt: new Date(base + CNIL_OFFSET_H * 3_600_000) });
  return plans;
}

export const DEADLINE_STATES = ['faite', 'depasse', 'proche', 'a_venir'] as const;
export type DeadlineState = (typeof DEADLINE_STATES)[number];

/** Fenêtre « échéance proche » : 12 heures avant le terme. */
export const SOON_HOURS = 12;

/**
 * État d'une échéance réglementaire : faite (transmise), dépassée, proche
 * (< 12 h), ou à venir. Sert au compte à rebours vivant de l'écran.
 */
export function deadlineState(dueAt: Date, sentAt: Date | null, now: Date): DeadlineState {
  if (sentAt) return 'faite';
  const diffH = (dueAt.getTime() - now.getTime()) / 3_600_000;
  if (diffH < 0) return 'depasse';
  if (diffH <= SOON_HOURS) return 'proche';
  return 'a_venir';
}

/** Heures restantes avant l'échéance (négatif si dépassée), arrondies. */
export function hoursUntil(dueAt: Date, now: Date): number {
  return Math.round((dueAt.getTime() - now.getTime()) / 3_600_000);
}

/**
 * Clôture autorisée ? (RM §6.1) : un incident qualifié « important NIS 2 » ne
 * peut être clos sans retour d'expérience (REX) renseigné.
 */
export function canCloseIncident(input: {
  nis2Important: boolean;
  rex: string | null;
}): boolean {
  if (!input.nis2Important) return true;
  return typeof input.rex === 'string' && input.rex.trim().length > 0;
}
