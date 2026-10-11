import 'server-only';

import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';

import { buildAuthOptions } from './auth-options.ts';
import { authDb } from './db.ts';
import { outboxSealer } from './email-outbox.ts';
import { env } from './env.ts';
import { createPasswordResetHooks } from './password-reset.ts';

let instance: ReturnType<typeof buildAuth> | undefined;

function buildAuth() {
  const options = buildAuthOptions({
    db: authDb().db,
    baseURL: env().BETTER_AUTH_URL,
    secret: env().BETTER_AUTH_SECRET,
    passwordReset: createPasswordResetHooks({ db: authDb().db, sealer: outboxSealer }),
  });
  return betterAuth({ ...options, plugins: [...options.plugins, nextCookies()] });
}

export function auth() {
  instance ??= buildAuth();
  return instance;
}
