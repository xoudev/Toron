// Interface commune des transports d'e-mails (ADR-8). Un transport ne lève
// jamais : tout échec revient classé, pour que la boucle sache s'il faut
// reprendre, abandonner ou remettre la ligne en file.

import { isReservedRecipient, recipientAllowed, type ProviderVerdict } from '@toron/core';

import type { MailTransportConfig } from './env.ts';
import { createFichierMailer } from './transports/fichier.ts';
import { createScalewayTemMailer } from './transports/scaleway-tem.ts';

export interface OutgoingEmail {
  /** Identifiant de la ligne de la file (ou référence de l'essai) : UUID. */
  reference: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Au-delà, le fournisseur doit renoncer : le lien aura expiré. */
  sendBefore: Date;
}

export interface SendFailure {
  ok: false;
  verdict: Exclude<ProviderVerdict, { effect: 'envoye' }>;
  retryAfterSeconds?: number;
  httpStatus?: number;
  /** Code machine de la cause locale (errno), jamais un message. */
  cause?: string;
}

export type SendOutcome = { ok: true; providerMessageId: string | null } | SendFailure;

export interface Mailer {
  readonly transport: 'scaleway' | 'fichier' | 'memoire';
  send(email: OutgoingEmail): Promise<SendOutcome>;
}

export interface RecipientPolicy {
  /** Transport réel : une adresse de domaine réservé n'aboutirait nulle part et nuirait à la réputation. */
  blockReserved: boolean;
  /** Liste blanche du staging ; null hors staging. */
  allowlist: readonly string[] | null;
}

export function recipientPermitted(address: string, policy: RecipientPolicy): boolean {
  if (policy.blockReserved && isReservedRecipient(address)) return false;
  if (policy.allowlist !== null && !recipientAllowed(address, policy.allowlist)) return false;
  return true;
}

/** Transport désigné par l'environnement validé (MAIL_TRANSPORT). */
export function createMailer(transport: MailTransportConfig, from: string): Mailer {
  return transport.kind === 'scaleway'
    ? createScalewayTemMailer({ secretKey: transport.secretKey, projectId: transport.projectId, region: transport.region, from })
    : createFichierMailer(transport.dir);
}
