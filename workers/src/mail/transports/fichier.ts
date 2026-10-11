// Transport de développement et de staging : chaque e-mail est déposé dans
// un répertoire, lisible par le seul compte du service (mode 0600). Il n'y a
// volontairement pas de transport « console », qui afficherait le lien.

import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { errorCode, logMail } from '../log.ts';
import type { Mailer, OutgoingEmail, SendOutcome } from '../mailer.ts';

const REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_MODE = 0o600;

async function writePrivate(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: 'utf8', mode: FILE_MODE });
  // Une redistribution réécrit le même fichier, dont le mode n'est pas repris.
  await chmod(path, FILE_MODE);
}

export function createFichierMailer(dir: string): Mailer {
  async function send(email: OutgoingEmail): Promise<SendOutcome> {
    // La référence devient un nom de fichier : rien d'autre qu'un UUID.
    if (!REFERENCE.test(email.reference)) {
      return { ok: false, verdict: { effect: 'definitif', code: 'REFUS_FOURNISSEUR' }, cause: 'REFERENCE_INVALIDE' };
    }
    const reference = email.reference.toLowerCase();
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const record = {
        reference,
        to: email.to,
        subject: email.subject,
        sendBefore: email.sendBefore.toISOString(),
        text: email.text,
        html: email.html,
      };
      await writePrivate(join(dir, `${reference}.json`), `${JSON.stringify(record, null, 2)}\n`);
      await writePrivate(join(dir, `${reference}.html`), email.html);
    } catch (err) {
      // Répertoire absent, en lecture seule ou plein : défaut de configuration, pas du message.
      return { ok: false, verdict: { effect: 'liberation', code: 'CONFIGURATION' }, cause: errorCode(err) };
    }
    logMail('depose_fichier', { outboxId: reference, transport: 'fichier' });
    return { ok: true, providerMessageId: null };
  }

  return { transport: 'fichier', send };
}
