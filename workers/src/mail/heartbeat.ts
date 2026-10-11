// Battement de cœur du service mail : un fichier réécrit à chaque tour de
// boucle réussi, lu par le healthcheck (mail-health.ts). Il ne contient
// qu'une date et un état, jamais de donnée de la file.

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

export const HEARTBEAT_FILE = join(tmpdir(), 'toron-mail.json');
/** Au-delà, le service est jugé bloqué : boucle figée ou base injoignable. */
export const HEARTBEAT_MAX_AGE_SECONDS = 60;

export const HEARTBEAT_STATES = ['actif', 'suspendu', 'disjoncteur'] as const;

const heartbeatSchema = z.object({
  at: z.iso.datetime({ offset: true }),
  etat: z.enum(HEARTBEAT_STATES),
});

export type Heartbeat = z.infer<typeof heartbeatSchema>;

export async function writeHeartbeat(path: string, beat: Heartbeat): Promise<void> {
  // Écriture puis renommage : le healthcheck ne lit jamais un fichier à moitié écrit.
  // Création exclusive, réservée à l'utilisateur du service : un fichier ou un
  // lien posé à l'avance dans le répertoire temporaire n'est jamais suivi.
  const partial = `${path}.${process.pid}.tmp`;
  await rm(partial, { force: true });
  await writeFile(partial, JSON.stringify(beat), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(partial, path);
}

/** Âge du dernier battement en secondes, ou null s'il manque ou est illisible. */
export async function heartbeatAge(path: string, now: Date): Promise<number | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = heartbeatSchema.safeParse(json);
  if (!parsed.success) return null;
  return Math.max(0, (now.getTime() - Date.parse(parsed.data.at)) / 1000);
}
