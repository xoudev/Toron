/**
 * Analyse antivirus des fichiers déposés (clamd, protocole INSTREAM).
 * Fonctions pures : découpage du flux envoyé au démon et lecture de sa
 * réponse. La connexion réseau vit côté serveur web ; ici, rien ne dépend
 * d'une socket, tout se teste.
 */

/** Taille des tronçons envoyés à clamd (bien en deçà de sa limite par défaut). */
export const CLAMD_CHUNK_BYTES = 64 * 1024;

/** Commande INSTREAM, préfixe « z » : réponse terminée par un octet nul. */
export const CLAMD_INSTREAM_COMMAND = 'zINSTREAM\0';

/**
 * Trames INSTREAM : chaque tronçon est précédé de sa longueur sur quatre
 * octets (gros-boutiste) ; une longueur nulle clôt le flux.
 */
export function instreamFrames(content: Uint8Array, chunkSize = CLAMD_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError('Taille de tronçon invalide.');
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    const chunk = content.subarray(offset, Math.min(offset + chunkSize, content.length));
    const frame = new Uint8Array(4 + chunk.length);
    new DataView(frame.buffer).setUint32(0, chunk.length, false);
    frame.set(chunk, 4);
    frames.push(frame);
  }
  frames.push(new Uint8Array(4));
  return frames;
}

export type ScanVerdict =
  | { status: 'sain' }
  | { status: 'infecte'; signature: string }
  | { status: 'erreur'; detail: string };

/**
 * Lit la réponse de clamd : « stream: OK », « stream: <signature> FOUND »,
 * ou un message d'erreur (taille dépassée, base absente…). Toute réponse
 * inattendue est une erreur : on ne conclut jamais « sain » par défaut.
 */
export function parseClamdReply(reply: string): ScanVerdict {
  const text = reply.replace(/\0/g, '').trim();
  if (text === 'stream: OK') return { status: 'sain' };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) return { status: 'infecte', signature: found[1]!.trim().slice(0, 200) };
  return { status: 'erreur', detail: text.slice(0, 200) || 'réponse vide' };
}
