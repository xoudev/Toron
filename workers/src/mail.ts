// @toron/workers — service mail isolé (ADR-7/8). Réclame les e-mails de la
// file email_outbox sous le rôle toron_mail, qui n'a aucun droit sur les
// tables, ouvre le secret scellé, rend le gabarit et le remet au transport.
// Seul processus à détenir la clé Scaleway TEM.

import { setTimeout as delay } from 'node:timers/promises';

import { LEASE_SECONDS, MAX_SEND_ATTEMPTS, MIN_SEND_MARGIN_SECONDS } from '@toron/core';
import {
  claimNextEmail,
  createDb,
  emailOutboxHealth,
  markEmailFailed,
  markEmailSent,
  purgeEmailOutbox,
  releaseEmail,
} from '@toron/db';
import { deriveOutboxKey } from '@toron/mail';

import { parseMailEnv, reportEnvErrors } from './mail/env.ts';
import { HEARTBEAT_FILE, writeHeartbeat } from './mail/heartbeat.ts';
import { logMail } from './mail/log.ts';
import { createMailer } from './mail/mailer.ts';
import { createMailProcessor, type MailQueue } from './mail/process.ts';

/** Au-delà, l'arrêt est forcé ; le bail de la ligne en cours expirera seul. */
const SHUTDOWN_TIMEOUT_MS = 12_000;

const parsed = parseMailEnv(process.env);
if (!parsed.ok) {
  reportEnvErrors(parsed.errors);
  process.exit(1);
}
const env = parsed.env;

const keys = [env.outboxKey, ...(env.outboxKeyPrevious === null ? [] : [env.outboxKeyPrevious])].map(deriveOutboxKey);
const mailer = createMailer(env.transport, env.from);
const { db, close } = createDb(env.databaseUrl);

const queue: MailQueue = {
  claim: () => claimNextEmail(db, {
    leaseSeconds: LEASE_SECONDS,
    minMarginSeconds: MIN_SEND_MARGIN_SECONDS,
    maxAttempts: MAX_SEND_ATTEMPTS,
  }),
  markSent: (id, lease, providerId) => markEmailSent(db, id, lease, providerId),
  markFailed: (id, lease, code, retryAt) => markEmailFailed(db, id, lease, code, retryAt),
  release: (id, lease) => releaseEmail(db, id, lease),
  purge: (days) => purgeEmailOutbox(db, days),
  health: () => emailOutboxHealth(db),
};

const controller = new AbortController();
const processor = createMailProcessor({
  queue,
  mailer,
  keys,
  publicBaseUrl: env.publicBaseUrl,
  recipients: { blockReserved: env.transport.kind === 'scaleway', allowlist: env.allowlist },
  suspended: env.suspended,
  pollMs: env.pollMs,
  clock: {
    now: () => new Date(),
    sleep: (ms, signal) => delay(ms, undefined, { signal }).catch(() => {}),
  },
  heartbeat: (beat) => writeHeartbeat(HEARTBEAT_FILE, beat),
  signal: controller.signal,
});

function stop(): void {
  if (controller.signal.aborted) return;
  logMail('arret');
  controller.abort();
  setTimeout(() => {
    logMail('arret_force');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

logMail(env.transport.kind === 'fichier' ? 'demarrage_fichier' : 'demarrage_scaleway', { transport: env.transport.kind });
await processor.run();
await close().catch(() => {});
logMail('arrete');
process.exit(0);
