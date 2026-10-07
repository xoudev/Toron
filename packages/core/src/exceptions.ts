/**
 * Dérogations aux règles de sécurité et de qualité. Règles pures : fenêtre
 * de validité, état à une date, droit de demander, de statuer, de clôturer
 * et de renouveler. Le serveur décide, l'interface reflète ; la base double
 * les garde-fous essentiels (migration 0032).
 */

import { canManageControls, type MembershipRole } from './authz.ts';
import { daysUntil } from './work.ts';

export const EXCEPTION_STATUSES = ['demandee', 'approuvee', 'refusee', 'cloturee'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

/** Durée maximale d'une dérogation : au-delà, on renouvelle et on statue à nouveau. */
export const EXCEPTION_MAX_MONTHS = 12;
/** Préavis avant l'échéance : le responsable renouvelle ou clôture. */
export const EXCEPTION_NOTICE_DAYS = 30;
/** Durée proposée pour une nouvelle demande ou un renouvellement. */
export const EXCEPTION_DEFAULT_MONTHS = 6;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** AAAA-MM-JJ + n mois, le jour ramené au dernier jour du mois au besoin (comme Postgres). */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(Math.min(d!, lastDay))}`;
}

/** AAAA-MM-JJ + n jours. */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Dernier jour de validité autorisé pour une date de début. */
export function maxExceptionExpiry(startsOn: string): string {
  return addMonthsIso(startsOn, EXCEPTION_MAX_MONTHS);
}

/** Fenêtre proposée : à partir d'une date, pour la durée par défaut. */
export function defaultExceptionWindow(startsOn: string): { startsOn: string; expiresOn: string } {
  return { startsOn, expiresOn: addDaysIso(addMonthsIso(startsOn, EXCEPTION_DEFAULT_MONTHS), -1) };
}

/**
 * Motif de refus d'une fenêtre de validité, ou null si elle convient : une
 * échéance après le début, douze mois au plus, et pas déjà passée.
 */
export function exceptionWindowError(startsOn: string, expiresOn: string, today: string): string | null {
  if (!ISO_DATE.test(startsOn) || !ISO_DATE.test(expiresOn)) return 'Dates attendues au format AAAA-MM-JJ.';
  if (expiresOn <= startsOn) return 'L’échéance doit suivre la date de début.';
  if (expiresOn > maxExceptionExpiry(startsOn)) {
    return `Une dérogation dure ${EXCEPTION_MAX_MONTHS} mois au plus : renouvelez-la à l’échéance si l’écart persiste.`;
  }
  if (expiresOn < today) return 'Cette dérogation serait déjà échue : choisissez une échéance à venir.';
  return null;
}

export const EXCEPTION_STATES = [
  'en_attente', 'a_venir', 'en_vigueur', 'a_echeance', 'echue', 'renouvelee', 'refusee', 'cloturee',
] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

export const EXCEPTION_STATE_LABEL: Record<ExceptionState, string> = {
  en_attente: 'En attente de décision',
  a_venir: 'Accordée, à venir',
  en_vigueur: 'En vigueur',
  a_echeance: 'Échéance proche',
  echue: 'Échue',
  renouvelee: 'Renouvelée',
  refusee: 'Refusée',
  cloturee: 'Clôturée',
};

/** Renouvellement d'une dérogation : aucun, demandé (en attente) ou accordé. */
export type ExceptionRenewal = 'aucun' | 'demande' | 'accorde';

export interface ExceptionStateInput {
  status: ExceptionStatus;
  startsOn: string;
  /** Dernier jour de validité (inclus). */
  expiresOn: string;
  renewal: ExceptionRenewal;
}

/**
 * État d'une dérogation à une date. Une dérogation accordée est à venir,
 * en vigueur, proche de l'échéance (trente jours) ou échue ; une fois
 * échue, elle est « renouvelée » si un renouvellement accordé prend la suite.
 */
export function exceptionState(e: ExceptionStateInput, today: string): ExceptionState {
  if (e.status === 'demandee') return 'en_attente';
  if (e.status === 'refusee') return 'refusee';
  if (e.status === 'cloturee') return 'cloturee';
  if (today < e.startsOn) return 'a_venir';
  if (today > e.expiresOn) return e.renewal === 'accorde' ? 'renouvelee' : 'echue';
  if (e.renewal !== 'accorde' && daysUntil(e.expiresOn, today) <= EXCEPTION_NOTICE_DAYS) return 'a_echeance';
  return 'en_vigueur';
}

/** États qui appellent une décision, un renouvellement ou une clôture. */
export function exceptionNeedsAttention(state: ExceptionState): boolean {
  return state === 'en_attente' || state === 'a_echeance' || state === 'echue';
}

/** Une dérogation échue et non clôturée laisse un écart sans couverture. */
export function exceptionIsLapsed(state: ExceptionState): boolean {
  return state === 'echue';
}

// ── Droits ──────────────────────────────────────────────────────────────

/** Rôles qui statuent sur une dérogation — jamais sur celle qu'ils ont demandée ou dont ils répondent. */
const DECIDER_ROLES: ReadonlySet<MembershipRole> = new Set(['owner', 'direction', 'rssi', 'resp_qualite']);

export function canDecideExceptions(role: MembershipRole): boolean {
  return DECIDER_ROLES.has(role);
}

/** Demander une dérogation : les rôles qui gèrent les contrôles (pas le lecteur ni l'auditeur). */
export function canRequestException(role: MembershipRole): boolean {
  return canManageControls(role);
}

export type ExceptionVerdict = { ok: true } | { ok: false; reason: string };

export interface ExceptionActor {
  role: MembershipRole;
  actorUserId: string;
}

export interface ExceptionParties {
  status: ExceptionStatus;
  requestedBy: string;
  ownerUserId: string;
}

/** Statuer (approuver ou refuser) : un décideur, qui n'est ni le demandeur ni le responsable. */
export function exceptionDecisionVerdict(actor: ExceptionActor, e: ExceptionParties): ExceptionVerdict {
  if (e.status !== 'demandee') return { ok: false, reason: 'Cette dérogation a déjà été tranchée.' };
  if (!canDecideExceptions(actor.role)) {
    return { ok: false, reason: 'Seuls le propriétaire, la direction, le RSSI et le responsable qualité statuent sur une dérogation.' };
  }
  if (actor.actorUserId === e.requestedBy) {
    return { ok: false, reason: 'Vous avez demandé cette dérogation : une autre personne doit statuer (séparation des tâches).' };
  }
  if (actor.actorUserId === e.ownerUserId) {
    return { ok: false, reason: 'Vous êtes responsable de cette dérogation : une autre personne doit statuer (séparation des tâches).' };
  }
  return { ok: true };
}

function isParty(actor: ExceptionActor, e: ExceptionParties): boolean {
  return actor.actorUserId === e.requestedBy || actor.actorUserId === e.ownerUserId || canDecideExceptions(actor.role);
}

/** Modifier une demande : tant qu'elle n'est pas tranchée, par le demandeur, le responsable ou un décideur. */
export function exceptionEditVerdict(actor: ExceptionActor, e: ExceptionParties): ExceptionVerdict {
  if (e.status !== 'demandee') {
    return { ok: false, reason: 'Une dérogation tranchée ne se modifie plus : renouvelez-la pour en changer le contenu.' };
  }
  if (!canRequestException(actor.role) || !isParty(actor, e)) {
    return { ok: false, reason: 'Seuls le demandeur, le responsable ou un décideur modifient cette demande.' };
  }
  return { ok: true };
}

/** Clôturer : retirer une demande, ou mettre fin à une dérogation accordée parce que la règle s'applique de nouveau. */
export function exceptionCloseVerdict(actor: ExceptionActor, e: ExceptionParties): ExceptionVerdict {
  if (e.status === 'refusee') return { ok: false, reason: 'Une dérogation refusée est déjà close.' };
  if (e.status === 'cloturee') return { ok: false, reason: 'Cette dérogation est déjà clôturée.' };
  if (!canRequestException(actor.role) || !isParty(actor, e)) {
    return { ok: false, reason: 'Seuls le demandeur, le responsable ou un décideur clôturent cette dérogation.' };
  }
  return { ok: true };
}

/** Renouveler : une dérogation accordée, sans renouvellement déjà demandé ou accordé. */
export function exceptionRenewalVerdict(actor: ExceptionActor, e: ExceptionParties & { renewal: ExceptionRenewal }): ExceptionVerdict {
  if (e.status !== 'approuvee') return { ok: false, reason: 'Seule une dérogation accordée se renouvelle.' };
  if (e.renewal === 'demande') return { ok: false, reason: 'Un renouvellement est déjà en attente de décision.' };
  if (e.renewal === 'accorde') return { ok: false, reason: 'Cette dérogation a déjà été renouvelée.' };
  if (!canRequestException(actor.role) || !isParty(actor, e)) {
    return { ok: false, reason: 'Seuls le demandeur, le responsable ou un décideur renouvellent cette dérogation.' };
  }
  return { ok: true };
}

/**
 * Fenêtre proposée pour un renouvellement : il prend la suite le lendemain
 * de l'échéance, ou dès aujourd'hui si la dérogation est déjà échue.
 */
export function renewalWindow(expiresOn: string, today: string): { startsOn: string; expiresOn: string } {
  const next = addDaysIso(expiresOn, 1);
  return defaultExceptionWindow(next > today ? next : today);
}
