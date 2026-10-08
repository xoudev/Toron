/**
 * Portail de réponse fournisseur (module 5.10, V2). L'organisation envoie
 * un lien personnel au contact d'un fournisseur, qui répond au
 * questionnaire sans compte. Règles pures : cycle de vie d'une demande,
 * accès au portail et nettoyage des réponses venues de l'extérieur. La note
 * reste calculée par `assessSupplier`, à la validation par l'organisation.
 */

import { addDaysIso } from './dates.ts';
import { SUPPLIER_ANSWERS, SUPPLIER_QUESTIONS, type SupplierAnswer, type SupplierAnswers } from './suppliers.ts';

export const SUPPLIER_REQUEST_STATUSES = ['envoyee', 'en_cours', 'soumise', 'validee', 'annulee'] as const;
export type SupplierRequestStatus = (typeof SUPPLIER_REQUEST_STATUSES)[number];

/** État vu par l'organisation : une demande restée ouverte au-delà de son lien est « expirée ». */
export type SupplierRequestState = SupplierRequestStatus | 'expiree';

export const SUPPLIER_REQUEST_STATE_LABEL: Record<SupplierRequestState, string> = {
  envoyee: 'Envoyée',
  en_cours: 'Réponse en cours',
  soumise: 'Réponse reçue',
  validee: 'Validée',
  annulee: 'Annulée',
  expiree: 'Lien expiré',
};

/** Le lien reste valable deux semaines après l'échéance demandée. */
export const PORTAL_GRACE_DAYS = 14;
/** Échéance au plus tard trois mois après l'envoi. */
export const PORTAL_MAX_DUE_DAYS = 90;
export const PORTAL_COMMENT_MAX = 1000;

export function portalExpiresOn(dueOn: string): string {
  return addDaysIso(dueOn, PORTAL_GRACE_DAYS);
}

export function supplierRequestState(status: SupplierRequestStatus, expiresOn: string, today: string): SupplierRequestState {
  if ((status === 'envoyee' || status === 'en_cours') && expiresOn < today) return 'expiree';
  return status;
}

export type PortalAccess = 'ouvert' | 'soumis' | 'expire' | 'clos';

/** Ce que voit le fournisseur en ouvrant son lien. */
export function portalAccess(status: SupplierRequestStatus, expiresOn: string, today: string): PortalAccess {
  if (status === 'annulee' || status === 'validee') return 'clos';
  if (status === 'soumise') return 'soumis';
  return expiresOn < today ? 'expire' : 'ouvert';
}

export function supplierRequestError(input: { dueOn: string; today: string }): string | null {
  if (input.dueOn <= input.today) return 'L’échéance doit être postérieure à aujourd’hui — laissez au fournisseur le temps de répondre.';
  if (input.dueOn > addDaysIso(input.today, PORTAL_MAX_DUE_DAYS)) return 'Échéance trop lointaine — trois mois au plus après l’envoi.';
  return null;
}

export interface PortalDraft {
  answers: Partial<SupplierAnswers>;
  comments: Record<string, string>;
}

/**
 * Réponses reçues du portail : seules les questions connues et les réponses
 * prévues sont gardées ; les commentaires sont rognés et bornés.
 */
export function cleanPortalDraft(answers: Record<string, unknown>, comments: Record<string, unknown>): PortalDraft {
  const out: PortalDraft = { answers: {}, comments: {} };
  for (const q of SUPPLIER_QUESTIONS) {
    const a = answers[q.key];
    if (typeof a === 'string' && (SUPPLIER_ANSWERS as readonly string[]).includes(a)) out.answers[q.key] = a as SupplierAnswer;
    const c = comments[q.key];
    if (typeof c === 'string' && c.trim()) out.comments[q.key] = c.trim().slice(0, PORTAL_COMMENT_MAX);
  }
  return out;
}

/** Questions encore sans réponse, dans l'ordre du questionnaire. */
export function portalMissing(answers: Partial<SupplierAnswers>): string[] {
  return SUPPLIER_QUESTIONS.filter((q) => !answers[q.key]).map((q) => q.key);
}

/** Réponse reçue : prévenir le demandeur et le responsable du fournisseur, sans doublon. */
export function supplierResponseRecipients(input: { requestedBy: string | null; ownerUserId: string | null }): string[] {
  return [...new Set([input.requestedBy, input.ownerUserId].filter((id): id is string => id !== null))];
}

export function supplierResponseTitle(supplierName: string): string {
  const name = supplierName.trim().replace(/\s+/g, ' ');
  const short = name.length > 160 ? `${name.slice(0, 157)}…` : name;
  return `Questionnaire rempli par le fournisseur : ${short}`;
}
