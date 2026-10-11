// Envoi d'essai : node workers/src/mail-essai.ts <adresse>
// Gabarit « essai » remis directement au transport configuré, sans passer
// par la file, avec les mêmes gardes que le service. N'affiche que la
// référence locale (nom du fichier en transport fichier), l'identifiant
// rendu par le fournisseur et, en échec, les codes de la cause : jamais
// l'adresse.

import { randomUUID } from 'node:crypto';

import { emailLink, render } from '@toron/mail';
import { z } from 'zod';

import { parseMailEnv, reportEnvErrors } from './mail/env.ts';
import { createMailer, recipientPermitted } from './mail/mailer.ts';

/** Validité annoncée au fournisseur, comme pour un lien de réinitialisation. */
const ESSAI_SEND_BEFORE_MS = 30 * 60 * 1000;

const parsed = parseMailEnv(process.env);
if (!parsed.ok) {
  reportEnvErrors(parsed.errors);
  process.exit(1);
}
const env = parsed.env;

const recipient = z.email().safeParse(process.argv[2]?.trim());
if (!recipient.success || process.argv.length > 3) {
  console.error('Usage : node workers/src/mail-essai.ts <adresse> — une seule adresse e-mail valide attendue.');
  process.exit(2);
}
const to = recipient.data.toLowerCase();

if (env.suspended) {
  console.error('Envoi suspendu (MAIL_ENVOI_SUSPENDU=1) — retirez l’interrupteur pour faire l’essai.');
  process.exit(1);
}
if (!recipientPermitted(to, { blockReserved: env.transport.kind === 'scaleway', allowlist: env.allowlist })) {
  console.error('Destinataire refusé — domaine réservé avec le transport scaleway, ou adresse hors de MAIL_DESTINATAIRES_AUTORISES.');
  process.exit(1);
}

const now = new Date();
const reference = randomUUID();
const email = render('essai', { params: {}, link: emailLink('essai', env.publicBaseUrl, null), origin: env.publicBaseUrl, now });
const outcome = await createMailer(env.transport, env.from).send({
  reference,
  to,
  subject: email.subject,
  text: email.text,
  html: email.html,
  sendBefore: new Date(now.getTime() + ESSAI_SEND_BEFORE_MS),
});

if (outcome.ok) {
  const provider = outcome.providerMessageId === null ? '' : `, identifiant fournisseur ${outcome.providerMessageId}`;
  process.stdout.write(`Essai remis au transport ${env.transport.kind} — référence ${reference}${provider}.\n`);
  process.exit(0);
}
const status = outcome.httpStatus === undefined ? '' : `, HTTP ${outcome.httpStatus}`;
const cause = outcome.cause === undefined ? '' : ` (${outcome.cause})`;
console.error(
  `Essai en échec — ${outcome.verdict.code}${cause}${status}, référence ${reference}. Consultez docs/exploitation-courriel.md.`,
);
process.exit(1);
