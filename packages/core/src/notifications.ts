/**
 * Centre de notifications (module 5.12). Règles pures : quand prévenir un
 * membre, et quoi lui dire.
 */

export const NOTIFICATION_SUBJECTS = ['action', 'risque', 'obligation', 'fournisseur', 'traitement', 'derogation'] as const;
export type NotificationSubject = (typeof NOTIFICATION_SUBJECTS)[number];

const SUBJECT_PATH: Record<NotificationSubject, string> = {
  action: 'plan-action',
  risque: 'risques',
  obligation: 'obligations',
  fournisseur: 'fournisseurs',
  traitement: 'traitements',
  derogation: 'derogations',
};

const SUBJECT_PHRASE: Record<NotificationSubject, string> = {
  action: 'Une action vous est confiée',
  risque: 'Un risque vous est confié',
  obligation: 'Une obligation vous est confiée',
  fournisseur: 'Un fournisseur vous est confié',
  traitement: 'Une fiche de traitement vous est confiée',
  derogation: 'Une dérogation vous est confiée',
};

/**
 * Prévenir le nouveau responsable, sauf s'il se l'attribue lui-même ou s'il
 * l'était déjà : un changement sans effet ne crée pas de bruit.
 */
export function shouldNotifyAssignment(input: { actorUserId: string; previousOwnerId: string | null; nextOwnerId: string | null }): boolean {
  const next = input.nextOwnerId;
  return next !== null && next !== input.actorUserId && next !== input.previousOwnerId;
}

/** Lien interne vers l'objet, ouvert directement dans son écran. */
export function notificationHref(slug: string, subject: NotificationSubject, objectId: string): string {
  return `/t/${slug}/${SUBJECT_PATH[subject]}?ouvrir=${objectId}`;
}

/** Libellé de la notification, borné pour l'affichage. */
export function assignmentTitle(subject: NotificationSubject, objectTitle: string): string {
  const name = objectTitle.trim().replace(/\s+/g, ' ');
  const short = name.length > 160 ? `${name.slice(0, 157)}…` : name;
  return `${SUBJECT_PHRASE[subject]} : ${short}`;
}

/**
 * Destinataires d'une décision : le demandeur et le responsable, sans
 * doublon, et jamais l'auteur de la décision lui-même.
 */
export function decisionRecipients(input: { actorUserId: string; requestedBy: string; ownerUserId: string }): string[] {
  return [...new Set([input.requestedBy, input.ownerUserId])].filter((id) => id !== input.actorUserId);
}

/** Libellé d'une notification de décision sur une dérogation. */
export function exceptionDecisionTitle(approved: boolean, objectTitle: string): string {
  const name = objectTitle.trim().replace(/\s+/g, ' ');
  const short = name.length > 160 ? `${name.slice(0, 157)}…` : name;
  return `${approved ? 'Dérogation accordée' : 'Dérogation refusée'} : ${short}`;
}