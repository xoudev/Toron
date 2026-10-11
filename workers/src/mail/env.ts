// Environnement du service mail, validé au démarrage. Les messages disent
// la cause et la correction, sans jamais recopier une valeur : plusieurs
// variables sont des secrets.

import { isAbsolute } from 'node:path';

import { isReservedRecipient, publicOrigin } from '@toron/core';
import { OUTBOX_KEY_MIN_LENGTH } from '@toron/mail';
import { z } from 'zod';

export const TORON_ENVS = ['local', 'ci', 'staging', 'production'] as const;
export type ToronEnv = (typeof TORON_ENVS)[number];

export const MAIL_TRANSPORTS = ['scaleway', 'fichier'] as const;
export const SCALEWAY_REGIONS = ['fr-par', 'nl-ams', 'pl-waw'] as const;
export type ScalewayRegion = (typeof SCALEWAY_REGIONS)[number];

export const MAIL_POLL_MS_DEFAULT = 2000;

export type MailTransportConfig =
  | { kind: 'scaleway'; secretKey: string; projectId: string; region: ScalewayRegion }
  | { kind: 'fichier'; dir: string };

export interface MailEnv {
  toronEnv: ToronEnv;
  databaseUrl: string;
  outboxKey: string;
  outboxKeyPrevious: string | null;
  transport: MailTransportConfig;
  from: string;
  publicBaseUrl: string;
  allowlist: readonly string[] | null;
  suspended: boolean;
  pollMs: number;
}

export type EnvResult<T> = { ok: true; env: T } | { ok: false; errors: string[] };

const KEY_HINT = `${OUTBOX_KEY_MIN_LENGTH} caractères au moins, la même valeur que pour le web (openssl rand -hex 32)`;

const databaseUrl = z
  .string({ error: 'DATABASE_URL_MAIL manquante — chaîne de connexion du rôle toron_mail_login.' })
  .regex(/^postgres(ql)?:\/\/\S+$/, { error: 'DATABASE_URL_MAIL invalide — URL postgres:// du rôle toron_mail_login attendue.' });

function isOrigin(value: string): boolean {
  try {
    publicOrigin(value);
    return true;
  } catch {
    return false;
  }
}

const schema = z.object({
  TORON_ENV: z.enum(TORON_ENVS, { error: 'TORON_ENV manquante ou invalide — indiquez local, ci, staging ou production.' }),
  DATABASE_URL_MAIL: databaseUrl,
  MAIL_OUTBOX_KEY: z
    .string({ error: `MAIL_OUTBOX_KEY manquante — ${KEY_HINT}.` })
    .min(OUTBOX_KEY_MIN_LENGTH, { error: `MAIL_OUTBOX_KEY trop courte — ${KEY_HINT}.` }),
  MAIL_OUTBOX_KEY_PRECEDENTE: z
    .string()
    .min(OUTBOX_KEY_MIN_LENGTH, { error: `MAIL_OUTBOX_KEY_PRECEDENTE trop courte — ${OUTBOX_KEY_MIN_LENGTH} caractères au moins, ou retirez-la.` })
    .optional(),
  MAIL_TRANSPORT: z.enum(MAIL_TRANSPORTS, {
    error: 'MAIL_TRANSPORT manquante ou invalide — indiquez scaleway ou fichier (aucune valeur par défaut).',
  }),
  MAIL_FROM: z.email({
    error: 'MAIL_FROM manquante ou invalide — adresse d’expédition seule, par exemple ne-pas-repondre@notifications.toron.eu.',
  }),
  PUBLIC_BASE_URL: z
    .string({ error: 'PUBLIC_BASE_URL manquante — origine publique de l’application, par exemple https://app.toron.eu.' })
    .refine(isOrigin, { error: 'PUBLIC_BASE_URL invalide — origine seule (schéma, hôte, port), sans chemin ni paramètres.' }),
  MAIL_FICHIER_DIR: z
    .string()
    .refine(isAbsolute, { error: 'MAIL_FICHIER_DIR invalide — chemin absolu attendu, par exemple /var/toron/courriels.' })
    .optional(),
  SCW_TEM_SECRET_KEY: z
    .guid({ error: 'SCW_TEM_SECRET_KEY invalide — clé secrète d’API Scaleway (format UUID) de l’application IAM d’envoi.' })
    .optional(),
  SCW_TEM_PROJECT_ID: z
    .guid({ error: 'SCW_TEM_PROJECT_ID invalide — identifiant (UUID) du projet Scaleway portant TEM.' })
    .optional(),
  SCW_TEM_REGION: z
    .enum(SCALEWAY_REGIONS, { error: `SCW_TEM_REGION invalide — indiquez ${SCALEWAY_REGIONS.join(', ')} (fr-par par défaut).` })
    .default('fr-par'),
  MAIL_DESTINATAIRES_AUTORISES: z.string().optional(),
  MAIL_ENVOI_SUSPENDU: z
    .enum(['0', '1'], { error: 'MAIL_ENVOI_SUSPENDU invalide — 1 pour suspendre l’envoi, 0 ou absente sinon.' })
    .optional(),
  MAIL_POLL_MS: z.coerce
    .number({ error: 'MAIL_POLL_MS invalide — nombre de millisecondes entre 200 et 10000.' })
    .int({ error: 'MAIL_POLL_MS invalide — nombre entier de millisecondes entre 200 et 10000.' })
    .min(200, { error: 'MAIL_POLL_MS trop faible — 200 ms au moins.' })
    .max(10_000, { error: 'MAIL_POLL_MS trop élevé — 10000 ms au plus, sinon le healthcheck échoue.' })
    .default(MAIL_POLL_MS_DEFAULT),
});

/** Variables vides traitées comme absentes : un « VAR= » de compose ne vaut pas une valeur. */
function present(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') out[key] = value.trim();
  }
  return out;
}

function zodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.message);
}

const ALLOWLIST_ENTRY = /^(?:[^@\s,]+@|@)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function parseAllowlist(raw: string): string[] | null {
  const entries = raw.split(',').map((e) => e.trim().toLowerCase());
  if (entries.length === 0 || entries.some((e) => !ALLOWLIST_ENTRY.test(e))) return null;
  return entries;
}

/**
 * Valide l'environnement complet du service mail et refuse les combinaisons
 * dangereuses : envoi réel depuis un poste ou la CI, dépôt sur disque en
 * production, staging sans liste blanche.
 */
export function parseMailEnv(source: Record<string, string | undefined>): EnvResult<MailEnv> {
  const parsed = schema.safeParse(present(source));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const v = parsed.data;
  const errors: string[] = [];
  const devEnv = v.TORON_ENV === 'local' || v.TORON_ENV === 'ci';

  if (v.MAIL_TRANSPORT === 'scaleway' && devEnv) {
    errors.push(`MAIL_TRANSPORT=scaleway refusé avec TORON_ENV=${v.TORON_ENV} — utilisez MAIL_TRANSPORT=fichier : aucun e-mail réel ne part d’un poste ni de la CI.`);
  }
  if (v.SCW_TEM_SECRET_KEY !== undefined && devEnv) {
    errors.push(`SCW_TEM_SECRET_KEY refusée avec TORON_ENV=${v.TORON_ENV} — retirez la clé : elle ne doit exister que dans le service mail du staging et de la production.`);
  }
  if (v.MAIL_TRANSPORT === 'fichier' && v.TORON_ENV === 'production') {
    errors.push('MAIL_TRANSPORT=fichier refusé en production — utilisez MAIL_TRANSPORT=scaleway : les e-mails doivent partir.');
  }
  if (v.MAIL_FICHIER_DIR !== undefined && v.TORON_ENV === 'production') {
    errors.push('MAIL_FICHIER_DIR refusée en production — retirez-la : aucun e-mail n’est déposé sur disque.');
  }
  if (v.MAIL_DESTINATAIRES_AUTORISES !== undefined && v.TORON_ENV === 'production') {
    errors.push('MAIL_DESTINATAIRES_AUTORISES refusée en production — retirez-la : elle bloquerait les e-mails des clients.');
  }
  if (v.MAIL_TRANSPORT === 'scaleway' && v.TORON_ENV === 'staging' && v.MAIL_DESTINATAIRES_AUTORISES === undefined) {
    errors.push('MAIL_DESTINATAIRES_AUTORISES manquante — obligatoire en staging avec MAIL_TRANSPORT=scaleway : listez les adresses ou domaines de l’équipe, séparés par des virgules.');
  }
  if (!devEnv && new URL(v.PUBLIC_BASE_URL).protocol !== 'https:') {
    errors.push(`PUBLIC_BASE_URL doit être en https avec TORON_ENV=${v.TORON_ENV} — les liens envoyés par e-mail portent des jetons.`);
  }

  let allowlist: string[] | null = null;
  if (v.MAIL_DESTINATAIRES_AUTORISES !== undefined) {
    allowlist = parseAllowlist(v.MAIL_DESTINATAIRES_AUTORISES);
    if (allowlist === null) {
      errors.push('MAIL_DESTINATAIRES_AUTORISES invalide — adresses ou domaines séparés par des virgules, par exemple rssi@meridiane.fr,toron.eu.');
    }
  }

  let transport: MailTransportConfig | null = null;
  if (v.MAIL_TRANSPORT === 'scaleway') {
    if (v.SCW_TEM_SECRET_KEY === undefined) {
      errors.push('SCW_TEM_SECRET_KEY manquante — clé secrète de l’application IAM limitée à l’envoi TEM, requise avec MAIL_TRANSPORT=scaleway.');
    }
    if (v.SCW_TEM_PROJECT_ID === undefined) {
      errors.push('SCW_TEM_PROJECT_ID manquante — identifiant du projet Scaleway portant TEM, requis avec MAIL_TRANSPORT=scaleway.');
    }
    if (isReservedRecipient(v.MAIL_FROM)) {
      errors.push('MAIL_FROM invalide avec MAIL_TRANSPORT=scaleway — domaine réservé ; utilisez le domaine d’envoi vérifié dans TEM.');
    }
    if (v.SCW_TEM_SECRET_KEY !== undefined && v.SCW_TEM_PROJECT_ID !== undefined) {
      transport = { kind: 'scaleway', secretKey: v.SCW_TEM_SECRET_KEY, projectId: v.SCW_TEM_PROJECT_ID, region: v.SCW_TEM_REGION };
    }
  } else if (v.MAIL_FICHIER_DIR === undefined) {
    errors.push('MAIL_FICHIER_DIR manquante — répertoire absolu de dépôt des e-mails, requis avec MAIL_TRANSPORT=fichier.');
  } else {
    transport = { kind: 'fichier', dir: v.MAIL_FICHIER_DIR };
  }

  if (errors.length > 0 || transport === null) return { ok: false, errors };
  return {
    ok: true,
    env: {
      toronEnv: v.TORON_ENV,
      databaseUrl: v.DATABASE_URL_MAIL,
      outboxKey: v.MAIL_OUTBOX_KEY,
      outboxKeyPrevious: v.MAIL_OUTBOX_KEY_PRECEDENTE ?? null,
      transport,
      from: v.MAIL_FROM.toLowerCase(),
      publicBaseUrl: publicOrigin(v.PUBLIC_BASE_URL),
      allowlist,
      suspended: v.MAIL_ENVOI_SUSPENDU === '1',
      pollMs: v.MAIL_POLL_MS,
    },
  };
}

/** Seule la base est nécessaire à la CLI d'état. */
export function parseMailDatabaseUrl(source: Record<string, string | undefined>): EnvResult<string> {
  const parsed = databaseUrl.safeParse(present(source)['DATABASE_URL_MAIL']);
  return parsed.success ? { ok: true, env: parsed.data } : { ok: false, errors: zodErrors(parsed.error) };
}

export function reportEnvErrors(errors: readonly string[]): void {
  console.error('[mail] configuration invalide — démarrage refusé :');
  for (const message of errors) console.error(`  - ${message}`);
}
