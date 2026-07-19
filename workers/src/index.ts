// @toron/workers — worker de compilation des livrables scellés (ADR-5/6/7).
// MVP : polling de la table exports via claim_next_export() ; compilation
// Typst + scellage. pg-boss sera introduit avec d'autres types de jobs.

import { claimNextExport, createDb } from '@toron/db';

import { processSoaExport } from './soa-export.ts';
import { processPvExport } from './pv-export.ts';

const DATABASE_URL_APP = process.env['DATABASE_URL_APP'];
const PUBLIC_BASE_URL = process.env['PUBLIC_BASE_URL'] ?? 'http://localhost:3000';
const POLL_INTERVAL_MS = Number(process.env['WORKER_POLL_MS'] ?? 2000);

if (!DATABASE_URL_APP) {
  console.error('DATABASE_URL_APP manquante — chaîne de connexion du rôle applicatif (toron_app).');
  process.exit(1);
}

const { db, close } = createDb(DATABASE_URL_APP);
let running = true;

async function loop(): Promise<void> {
  console.warn(`[worker] démarré · base de vérification ${PUBLIC_BASE_URL}`);
  while (running) {
    let processedSomething = false;
    try {
      const job = await claimNextExport(db);
      if (job) {
        processedSomething = true;
        console.warn(`[worker] export ${job.type} ${job.id} — compilation`);
        try {
          if (job.type === 'pv') await processPvExport(db, job, PUBLIC_BASE_URL);
          else await processSoaExport(db, job, PUBLIC_BASE_URL);
          console.warn(`[worker] export ${job.id} scellé`);
        } catch (err) {
          console.error('[worker] export en échec', {
            id: job.id,
            cause: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      console.error('[worker] boucle', { cause: err instanceof Error ? err.message : String(err) });
    }
    // Enchaîne s'il y avait du travail, sinon attend avant de re-sonder.
    if (!processedSomething) await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(signal: string): Promise<void> {
  console.warn(`[worker] arrêt (${signal})`);
  running = false;
  await close().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await loop();
