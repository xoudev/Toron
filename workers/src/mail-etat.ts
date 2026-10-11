// État de la file : node workers/src/mail-etat.ts
// Agrégats des dernières 24 heures par type, statut et code d'erreur, lus
// par email_outbox_health() sous le rôle toron_mail. Aucune adresse.

import { createDb, emailOutboxHealth } from '@toron/db';

import { parseMailDatabaseUrl, reportEnvErrors } from './mail/env.ts';
import { errorCode } from './mail/log.ts';

const parsed = parseMailDatabaseUrl(process.env);
if (!parsed.ok) {
  reportEnvErrors(parsed.errors);
  process.exit(1);
}

const { db, close } = createDb(parsed.env);
try {
  const rows = await emailOutboxHealth(db);
  if (rows.length === 0) {
    process.stdout.write('File vide sur les dernières 24 heures.\n');
  } else {
    const lines = rows.map((r) => [
      r.kind,
      r.status,
      r.lastErrorCode ?? '—',
      String(r.count),
      r.oldestPendingSeconds === null ? '—' : `${Math.round(r.oldestPendingSeconds)} s`,
    ]);
    const header = ['type', 'statut', 'code', 'nombre', 'plus ancien en attente'];
    const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i]!.length)));
    const format = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
    process.stdout.write(`${[format(header), ...lines.map(format)].join('\n')}\n`);
  }
} catch (err) {
  console.error(`Lecture de l’état impossible (${errorCode(err)}) — vérifiez DATABASE_URL_MAIL et que la migration 0041 est appliquée.`);
  process.exitCode = 1;
} finally {
  await close().catch(() => {});
}
