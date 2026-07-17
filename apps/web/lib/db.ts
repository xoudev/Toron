import 'server-only';

import { createDb, type DbHandle } from '@toron/db';

import { env } from './env.js';

// Deux connexions, deux rôles Postgres (S5) :
// - appDb  → toron_app  : données métier, toujours via withTenant()
// - authDb → toron_auth : identités, sessions, résolution tenant/membership

let app: DbHandle | undefined;
let auth: DbHandle | undefined;

export function appDb(): DbHandle {
  app ??= createDb(env().DATABASE_URL_APP);
  return app;
}

export function authDb(): DbHandle {
  auth ??= createDb(env().DATABASE_URL_AUTH);
  return auth;
}
