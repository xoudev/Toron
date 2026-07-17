import 'server-only';

import { hash, verify } from '@node-rs/argon2';
import { schema } from '@toron/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';

import { authDb } from './db.js';
import { env } from './env.js';

// Paramètres alignés sur les recommandations OWASP (§8.1). L'algorithme
// par défaut de @node-rs/argon2 est argon2id (variante exigée par ADR-4).
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

let instance: ReturnType<typeof buildAuth> | undefined;

function buildAuth() {
  return betterAuth({
    baseURL: env().BETTER_AUTH_URL,
    secret: env().BETTER_AUTH_SECRET,
    telemetry: { enabled: false },
    database: drizzleAdapter(authDb().db, {
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
      // ADR-4 : argon2id, pas le scrypt par défaut.
      password: {
        hash: (password) => hash(password, ARGON2_OPTIONS),
        verify: ({ hash: digest, password }) => verify(digest, password),
      },
    },
    user: {
      additionalFields: {
        locale: { type: 'string', defaultValue: 'fr', input: false },
      },
    },
    advanced: {
      database: {
        // Nos clés primaires sont des uuid Postgres (§8.1 : UUID partout).
        generateId: () => crypto.randomUUID(),
      },
    },
    plugins: [twoFactor(), nextCookies()],
  });
}

export function auth() {
  instance ??= buildAuth();
  return instance;
}
