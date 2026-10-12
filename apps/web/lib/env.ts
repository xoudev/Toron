import 'server-only';

import { OUTBOX_KEY_MIN_LENGTH } from '@toron/mail';
import { z } from 'zod';

// S3 : variables d'environnement validées par schéma. Validation
// paresseuse (au premier accès runtime) pour que `next build` en CI
// n'exige pas de secrets.
const EnvSchema = z.object({
  DATABASE_URL_APP: z
    .string()
    .min(1, 'DATABASE_URL_APP manquante — chaîne de connexion du rôle applicatif (toron_app).'),
  DATABASE_URL_AUTH: z
    .string()
    .min(1, 'DATABASE_URL_AUTH manquante — chaîne de connexion du rôle d’authentification.'),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET trop court — 32 caractères minimum (générez-le aléatoirement).'),
  BETTER_AUTH_URL: z.url('BETTER_AUTH_URL invalide — URL publique de l’application attendue.'),
  // Analyse antivirus des fichiers déposés (clamd). Sans scanneur, les dépôts
  // sont refusés ; la désactivation explicite n'est permise qu'en développement.
  CLAMAV_URL: z
    .string()
    .regex(/^tcp:\/\/[A-Za-z0-9.-]+:\d{1,5}$/, 'CLAMAV_URL invalide — attendu tcp://hôte:port (démon clamd).')
    .optional(),
  ANTIVIRUS_DESACTIVE: z.enum(['1']).optional(),
  // Environnement de déploiement : NODE_ENV vaut production dans toutes les
  // images, compose local compris, et ne distingue donc rien.
  TORON_ENV: z
    .enum(['local', 'staging', 'production'], 'TORON_ENV invalide — attendu local, staging ou production.')
    .default('local'),
  // Clé de scellement des liens déposés dans la file d'e-mails, partagée
  // avec le service mail. Absente en local : aucun e-mail n'est déposé.
  MAIL_OUTBOX_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string()
      .min(OUTBOX_KEY_MIN_LENGTH, `MAIL_OUTBOX_KEY trop courte — ${OUTBOX_KEY_MIN_LENGTH} caractères minimum (openssl rand -hex 32).`)
      .optional(),
  ),
}).superRefine((e, ctx) => {
  if (e.TORON_ENV !== 'local') {
    if (!e.MAIL_OUTBOX_KEY) {
      ctx.addIssue({ code: 'custom', message: `MAIL_OUTBOX_KEY manquante — obligatoire en ${e.TORON_ENV} pour envoyer les liens de réinitialisation (même valeur que le service mail).` });
    }
    if (!e.BETTER_AUTH_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', message: `BETTER_AUTH_URL doit être en https en ${e.TORON_ENV} — indiquez l’adresse publique sécurisée de l’application.` });
    }
  }
  if (process.env.NODE_ENV !== 'production') return;
  if (e.ANTIVIRUS_DESACTIVE) {
    ctx.addIssue({ code: 'custom', message: 'ANTIVIRUS_DESACTIVE est interdit en production — les fichiers déposés doivent être analysés.' });
  }
  if (!e.CLAMAV_URL) {
    ctx.addIssue({ code: 'custom', message: 'CLAMAV_URL manquante — l’analyse antivirus des fichiers déposés est obligatoire en production.' });
  }
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Valide un environnement ; lève une erreur qui liste chaque cause. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => i.message).join(' · ');
    throw new Error(`Configuration invalide au démarrage : ${details}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
