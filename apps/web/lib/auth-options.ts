import 'server-only';

import { hash, verify } from '@node-rs/argon2';
import {
  PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RESET_TTL_SECONDS, RESET_TOKEN_PATTERN,
  resetIdentifierStorage,
} from '@toron/core';
import { schema, type Db } from '@toron/db';
import { APIError, BASE_ERROR_CODES, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';

import type { PasswordResetHooks } from './password-reset.ts';

// Réglages Better Auth, séparés de lib/auth.ts pour être construits tels
// quels par les tests d'intégration (base de test, tâches d'arrière-plan
// attendues, sans l'extension Next qui exige un contexte de requête).

// Paramètres alignés sur les recommandations OWASP (§8.1). L'algorithme
// par défaut de @node-rs/argon2 est argon2id (variante exigée par ADR-4).
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface AuthOptionsDeps {
  /** Client du rôle d'identité (toron_auth). */
  db: Db;
  baseURL: string;
  secret: string;
  passwordReset: PasswordResetHooks;
  /**
   * Reçoit les tâches lancées après la réponse (dépôt de l'e-mail de
   * réinitialisation). Better Auth leur a déjà attaché un .catch.
   */
  backgroundTask?: (promise: Promise<unknown>) => void;
}

const LOG_MESSAGE_MAX_LENGTH = 300;

/**
 * Message de journal sans adresse ni jeton, sur une seule ligne. Better Auth
 * y recopie des valeurs du client (redirectTo, callbackURL) et passe parfois
 * un objet d'erreur : troncature d'abord, puis traitements linéaires.
 */
export function scrubLogMessage(message: unknown): string {
  if (typeof message !== 'string') return message instanceof Error ? message.name : '[message non textuel]';
  return message
    .slice(0, LOG_MESSAGE_MAX_LENGTH)
    .replace(/[\s\p{Cc}]/gu, ' ')
    .split(' ')
    .map((part) => (part.includes('@') ? '[adresse]' : part))
    .join(' ')
    .replace(/[A-Za-z0-9_-]{20,}/g, '[masqué]');
}

export function buildAuthOptions(deps: AuthOptionsDeps) {
  return {
    // Nom affiché comme émetteur dans les applications d'authentification.
    appName: 'Toron',
    baseURL: deps.baseURL,
    secret: deps.secret,
    telemetry: { enabled: false },
    database: drizzleAdapter(deps.db, {
      provider: 'pg',
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        twoFactors: schema.twoFactors,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Règle annoncée dans Paramètres › Sécurité et au formulaire
      // d'inscription : appliquée ici, pas seulement dans le navigateur
      // (la bibliothèque accepte 8 caractères par défaut).
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // ADR-4 : argon2id, pas le scrypt par défaut.
      password: {
        hash: (password: string) => hash(password, ARGON2_OPTIONS),
        verify: ({ hash: digest, password }: { hash: string; password: string }) => verify(digest, password),
      },
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      // `url` est ignorée : elle porte le jeton dans son chemin. Le service
      // mail construit le lien à fragment depuis PUBLIC_BASE_URL.
      sendResetPassword: ({ user, token }: { user: { id: string; email: string }; token: string }) =>
        deps.passwordReset.enqueuePasswordReset({ user, token }),
      // Ne lève jamais : sinon Better Auth ne révoquerait pas les sessions.
      onPasswordReset: ({ user }: { user: { id: string; email: string } }, request?: Request) =>
        deps.passwordReset.afterPasswordReset({ user, request }),
    },
    verification: {
      // Jeton de réinitialisation stocké en empreinte, préfixe conservé
      // (le réglage « hashed » de la bibliothèque le perdrait).
      storeIdentifier: { default: 'plain', overrides: { 'reset-password:': { hash: resetIdentifierStorage } } },
    },
    user: {
      additionalFields: {
        locale: { type: 'string', defaultValue: 'fr', input: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Le GET à jeton valide le lien sans le consommer puis redirige
        // avec ?token= : fermé, comme dans proxy.ts.
        if (ctx.path === '/reset-password/:token') throw new APIError('NOT_FOUND');
        if (ctx.path !== '/reset-password') return;
        // La bibliothèque retente en clair un identifiant introuvable sous
        // son empreinte : une empreinte lue en base servirait alors de
        // jeton. Seule la forme d'un vrai jeton, dans le corps, est admise.
        const query: unknown = ctx.query;
        const body: unknown = ctx.body;
        const token = body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined;
        const tokenInQuery = query && typeof query === 'object' && 'token' in query;
        if (tokenInQuery || typeof token !== 'string' || !RESET_TOKEN_PATTERN.test(token)) {
          throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.INVALID_TOKEN);
        }
      }),
    },
    advanced: {
      database: {
        // Nos clés primaires sont des uuid Postgres (§8.1 : UUID partout).
        generateId: () => crypto.randomUUID(),
      },
      // Le dépôt part après la réponse : sa durée ne dit rien de
      // l'existence du compte.
      backgroundTasks: {
        handler: deps.backgroundTask ?? ((promise: Promise<unknown>) => { void promise; }),
      },
    },
    // Une erreur qui n'est pas une APIError (base indisponible…) remonte
    // jusqu'à la route au lieu d'être écrite brute par le routeur : le
    // message d'une erreur Drizzle cite les paramètres de la requête.
    onAPIError: { throw: true },
    // Message seul : les arguments (objets d'erreur, requêtes) peuvent citer
    // une adresse ou un jeton. Niveau laissé par défaut (warn) : le préciser
    // ferait aussi écrire chaque APIError par Better Auth, hors de ce filtre.
    logger: {
      log: (level: 'debug' | 'info' | 'warn' | 'error', message: unknown) => {
        (level === 'error' ? console.error : console.warn)('[auth]', scrubLogMessage(message));
      },
    },
    plugins: [twoFactor({ issuer: 'Toron' })],
  } satisfies BetterAuthOptions;
}
