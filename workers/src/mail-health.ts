// Healthcheck du service mail : node workers/src/mail-health.ts
// Sain si le battement de cœur date de moins d'une minute.

import { HEARTBEAT_FILE, HEARTBEAT_MAX_AGE_SECONDS, heartbeatAge } from './mail/heartbeat.ts';

const age = await heartbeatAge(HEARTBEAT_FILE, new Date());
if (age === null) {
  console.error('Service mail : aucun battement de cœur lisible — le service démarre ou a échoué au démarrage.');
  process.exit(1);
}
if (age > HEARTBEAT_MAX_AGE_SECONDS) {
  console.error(`Service mail : dernier battement il y a ${Math.round(age)} s — boucle bloquée ou base injoignable.`);
  process.exit(1);
}
process.exit(0);
