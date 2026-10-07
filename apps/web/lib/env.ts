import 'server-only';

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
}).superRefine((e, ctx) => {
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

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => i.message).join(' · ');
      throw new Error(`Configuration invalide au démarrage : ${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}
