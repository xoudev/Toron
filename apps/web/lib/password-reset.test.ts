import { createHmac } from 'node:crypto';

import { ACCOUNT_EMAIL_QUOTAS, resetIdentifierStorage } from '@toron/core';
import { createDb, type Db, type DbHandle } from '@toron/db';
import { startTestDatabase, type TestDatabase } from '@toron/db/testing';
import { deriveOutboxKey, open } from '@toron/mail';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildAuthOptions } from './auth-options.ts';
import { createAuthRoute } from './auth-route.ts';
import { createOutboxSealer } from './email-outbox.ts';
import { createPasswordResetHooks, type PasswordResetHooks } from './password-reset.ts';

/**
 * Parcours « mot de passe oublié » de bout en bout côté serveur : l'instance
 * Better Auth construite par buildAuthOptions, appelée en HTTP, sur un
 * Postgres migré, sous le rôle d'identité réel (toron_auth). Les tâches
 * d'arrière-plan sont recueillies pour être attendues.
 */

const ORIGIN = 'http://localhost:3000';
const OUTBOX_KEY = 'cleDeTest'.padEnd(40, '0');
const OLD_PASSWORD = 'ancienne phrase de passe';
const NEW_PASSWORD = 'nouvelle phrase de passe';

let db: TestDatabase<'auth'>;
let admin: DbHandle;
let authHandle: DbHandle;
const pending: Promise<unknown>[] = [];
const tokens: string[] = [];
const emails: string[] = [];
const logs: string[] = [];

function makeAuth(hooks: PasswordResetHooks) {
  // Chaque jeton émis est relevé ici, pour vérifier ensuite qu'il n'a fuité nulle part.
  const recorded: PasswordResetHooks = {
    enqueuePasswordReset: (input) => {
      tokens.push(input.token);
      return hooks.enqueuePasswordReset(input);
    },
    afterPasswordReset: (input) => hooks.afterPasswordReset(input),
  };
  return betterAuth(buildAuthOptions({
    db: authHandle.db,
    baseURL: ORIGIN,
    secret: 'secret_de_test_better_auth_32_caracteres_min',
    passwordReset: recorded,
    backgroundTask: (p) => { pending.push(p); },
  }));
}

let auth: ReturnType<typeof makeAuth>;

beforeAll(async () => {
  for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(stringify).join(' '));
    });
  }
  db = await startTestDatabase({ logins: ['auth'] });
  admin = createDb(db.adminUri);
  authHandle = createDb(db.uris.auth);
  const sealer = createOutboxSealer(OUTBOX_KEY);
  auth = makeAuth(createPasswordResetHooks({ db: authHandle.db, sealer: () => sealer }));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await authHandle?.close();
  await admin?.close();
  await db?.stop();
});

function stringify(value: unknown): string {
  if (value instanceof Error) return `${value.message} ${value.stack ?? ''} ${stringify(value.cause)}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

async function flush(): Promise<void> {
  while (pending.length > 0) await Promise.all(pending.splice(0));
}

interface CallResult {
  status: number;
  text: string;
  body: unknown;
  cookie: string;
}

async function call(
  instance: { handler: (r: Request) => Promise<Response> },
  path: string,
  options: { body?: unknown; cookie?: string; method?: 'GET' | 'POST' } = {},
): Promise<CallResult> {
  const headers = new Headers({ origin: ORIGIN, 'user-agent': 'Vitest', 'x-forwarded-for': '203.0.113.9' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  const res = await instance.handler(new Request(`${ORIGIN}/api/auth${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, text, body, cookie };
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await admin.db.execute(query)) as unknown as T[];
}

let userCount = 0;

async function signUp(): Promise<{ id: string; email: string; cookie: string }> {
  userCount += 1;
  const email = `reinit-${userCount}@meridiane-logistics.example`;
  emails.push(email);
  const res = await call(auth, '/sign-up/email', { body: { email, password: OLD_PASSWORD, name: 'Compte de test' } });
  expect(res.status).toBe(200);
  const id = (res.body as { user: { id: string } }).user.id;
  return { id, email, cookie: res.cookie };
}

async function requestReset(instance: typeof auth, email: string): Promise<CallResult> {
  const res = await call(instance, '/request-password-reset', { body: { email } });
  await flush();
  return res;
}

function resetPassword(token: string, newPassword = NEW_PASSWORD) {
  return call(auth, '/reset-password', { body: { token, newPassword } });
}

async function resetIdentifiers(userId: string): Promise<string[]> {
  const r = await rows<{ identifier: string }>(sql`
    SELECT identifier FROM verifications WHERE value = ${userId} AND identifier LIKE 'reset-password:%'`);
  return r.map((x) => x.identifier);
}

interface OutboxRow {
  id: string;
  kind: string;
  recipient: string;
  params: Record<string, unknown>;
  secret_box: Buffer | null;
  secret_key_id: string | null;
}

function outbox(userId: string): Promise<OutboxRow[]> {
  return rows<OutboxRow>(sql`
    SELECT id, kind, recipient, params, secret_box, secret_key_id FROM email_outbox
    WHERE user_id = ${userId} ORDER BY created_at, id`);
}

/** Nombre d'occurrences d'une valeur dans toutes les colonnes texte de la base. */
async function occurrencesInDatabase(needle: string): Promise<number> {
  const columns = await rows<{ table_name: string; column_name: string }>(sql`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')`);
  let total = 0;
  for (const c of columns) {
    const [r] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ${sql.identifier(c.table_name)}
      WHERE ${sql.identifier(c.column_name)}::text LIKE ${`%${needle}%`}`);
    total += r?.n ?? 0;
  }
  return total;
}

/** Code TOTP courant (RFC 6238 : SHA-1, 6 chiffres, 30 s) d'une URI otpauth. */
function totp(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const offset = h[h.length - 1]! & 0x0f;
  return ((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/** Cookie d'appareil de confiance non vide parmi ceux reçus. */
function trustDeviceCookie(cookies: string): string {
  return cookies.split('; ').filter((c) => /trust_device=./.test(c)).join('; ');
}

function lastToken(): string {
  const t = tokens.at(-1);
  if (!t) throw new Error('Aucun jeton émis.');
  return t;
}

describe('mot de passe oublié — Better Auth branché sur la file scellée', () => {
  it('répond à l’identique pour un compte inconnu et un compte connu saisi en majuscules', async () => {
    const user = await signUp();
    const unknown = await requestReset(auth, 'personne@meridiane-logistics.example');
    emails.push('personne@meridiane-logistics.example');
    const before = tokens.length;
    const known = await requestReset(auth, user.email.toUpperCase());

    expect(known.status).toBe(200);
    expect(known.text).toBe(unknown.text);
    expect(known.status).toBe(unknown.status);
    expect(tokens.length).toBe(before + 1);
    const token = lastToken();

    const [identifier, ...others] = await resetIdentifiers(user.id);
    expect(others).toEqual([]);
    expect(identifier).toMatch(/^reset-password:[0-9a-f]{64}$/);
    expect(identifier).toBe(await resetIdentifierStorage(`reset-password:${token}`));

    const queued = await outbox(user.id);
    expect(queued).toHaveLength(1);
    const row = queued[0]!;
    expect(row).toMatchObject({ kind: 'mot_de_passe_reinitialisation', recipient: user.email, params: {} });
    expect(await occurrencesInDatabase(token)).toBe(0);

    const opened = open([deriveOutboxKey(OUTBOX_KEY)], {
      id: row.id, kind: 'mot_de_passe_reinitialisation', keyId: row.secret_key_id ?? '',
    }, row.secret_box ?? new Uint8Array());
    expect(opened).toBe(token);
  });

  it('répond avant la fin du dépôt, et ne lance aucun dépôt pour un compte inconnu', async () => {
    const user = await signUp();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sealer = createOutboxSealer(OUTBOX_KEY);
    const hooks = createPasswordResetHooks({ db: authHandle.db, sealer: () => sealer });
    const slow = makeAuth({
      enqueuePasswordReset: async (input) => {
        await gate;
        await hooks.enqueuePasswordReset(input);
      },
      afterPasswordReset: hooks.afterPasswordReset,
    });

    const unknown = await call(slow, '/request-password-reset', { body: { email: 'absent@meridiane-logistics.example' } });
    emails.push('absent@meridiane-logistics.example');
    expect(unknown.status).toBe(200);
    expect(pending).toHaveLength(0);

    // Une réponse qui attendrait le dépôt resterait bloquée sur la barrière.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const known = await Promise.race([
      call(slow, '/request-password-reset', { body: { email: user.email } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { release(); reject(new Error('La réponse a attendu le dépôt.')); }, 5_000);
      }),
    ]).finally(() => clearTimeout(timer));
    expect(known.status).toBe(200);
    expect(known.text).toBe(unknown.text);
    expect(pending).toHaveLength(1);
    expect(await outbox(user.id)).toEqual([]);

    release();
    await flush();
    expect(await outbox(user.id)).toHaveLength(1);
  });

  it('au-delà du quota horaire, ne dépose rien de plus et supprime le jeton refusé', async () => {
    const user = await signUp();
    const { perHour } = ACCOUNT_EMAIL_QUOTAS.mot_de_passe_reinitialisation;
    for (let i = 0; i < perHour; i += 1) await requestReset(auth, user.email);
    const lastAccepted = lastToken();
    expect(await outbox(user.id)).toHaveLength(perHour);

    const refused = await requestReset(auth, user.email);
    expect(refused.status).toBe(200);
    expect(await outbox(user.id)).toHaveLength(perHour);
    expect(await resetIdentifiers(user.id)).toEqual([await resetIdentifierStorage(`reset-password:${lastAccepted}`)]);
    expect((await resetPassword(lastToken())).body).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('seul le lien le plus récent fonctionne ; un mot de passe trop court laisse le lien valable', async () => {
    const user = await signUp();
    await requestReset(auth, user.email);
    const first = lastToken();
    await requestReset(auth, user.email);
    const second = lastToken();

    const stale = await resetPassword(first);
    expect(stale.status).toBe(400);
    expect(stale.body).toMatchObject({ code: 'INVALID_TOKEN' });

    const short = await resetPassword(second, 'a'.repeat(11));
    expect(short.status).toBe(400);
    expect(short.body).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
    expect(await resetIdentifiers(user.id)).toHaveLength(1);

    expect((await resetPassword(second)).status).toBe(200);
  });

  it('réinitialise un compte TOTP connecté : sessions et défis purgés, TOTP intact, audit et avis', async () => {
    const user = await signUp();
    const tenants: string[] = [];
    for (const slug of ['reinit-org-a', 'reinit-org-b']) {
      const [t] = await rows<{ id: string }>(sql`INSERT INTO tenants (name, slug) VALUES (${slug}, ${slug}) RETURNING id`);
      tenants.push(t!.id);
      await admin.db.execute(sql`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${t!.id}, ${user.id}, 'rssi')`);
    }
    await admin.db.execute(sql`UPDATE users SET two_factor_enabled = true WHERE id = ${user.id}`);
    await admin.db.execute(sql`
      INSERT INTO two_factors (user_id, secret, backup_codes) VALUES (${user.id}, 'secret-chiffre', 'codes-chiffres')`);
    await admin.db.execute(sql`
      INSERT INTO verifications (identifier, value, expires_at)
      VALUES ('trust-device-test', ${user.id}, now() + interval '30 days')`);
    const challenge = await call(auth, '/sign-in/email', { body: { email: user.email, password: OLD_PASSWORD } });
    expect(challenge.body).toMatchObject({ twoFactorRedirect: true });
    const [{ n: challenges } = { n: 0 }] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM verifications WHERE value = ${user.id} AND identifier LIKE '2fa-%'`);
    expect(challenges).toBe(1);
    const twoFactorBefore = await rows<Record<string, unknown>>(sql`SELECT * FROM two_factors WHERE user_id = ${user.id}`);

    await requestReset(auth, user.email);
    const token = lastToken();
    const done = await resetPassword(token);
    expect(done.status).toBe(200);
    await flush();

    const [{ n: sessions } = { n: -1 }] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM sessions WHERE user_id = ${user.id}`);
    expect(sessions).toBe(0);
    expect((await call(auth, '/get-session', { cookie: user.cookie })).body).toBeNull();
    const [{ n: verifications } = { n: -1 }] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM verifications WHERE value = ${user.id}`);
    expect(verifications).toBe(0);
    expect(await rows(sql`SELECT * FROM two_factors WHERE user_id = ${user.id}`)).toEqual(twoFactorBefore);
    const [verified] = await rows<{ email_verified: boolean; two_factor_enabled: boolean }>(sql`
      SELECT email_verified, two_factor_enabled FROM users WHERE id = ${user.id}`);
    expect(verified).toEqual({ email_verified: true, two_factor_enabled: true });

    const audit = await rows<{ tenant_id: string; object_type: string; object_id: string; actor_user_id: string; ip: string }>(sql`
      SELECT tenant_id, object_type, object_id, actor_user_id, host(ip) AS ip FROM audit_log
      WHERE action = 'account.password_reset' AND actor_user_id = ${user.id} ORDER BY tenant_id`);
    expect(audit).toEqual([...tenants].sort().map((tenantId) => ({
      tenant_id: tenantId, object_type: 'account', object_id: user.id, actor_user_id: user.id, ip: '203.0.113.9',
    })));

    const notices = (await outbox(user.id)).filter((r) => r.kind === 'mot_de_passe_modifie');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ recipient: user.email, secret_box: null });
    expect(notices[0]!.params.modifieLe).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

    // L'ancien mot de passe est refusé ; le nouveau mène toujours au second facteur.
    const old = await call(auth, '/sign-in/email', { body: { email: user.email, password: OLD_PASSWORD } });
    expect(old.status).toBe(401);
    const fresh = await call(auth, '/sign-in/email', { body: { email: user.email, password: NEW_PASSWORD } });
    expect(fresh.status).toBe(200);
    expect(fresh.body).toMatchObject({ twoFactorRedirect: true });
    expect(fresh.body).not.toHaveProperty('token');

    // Rejeu du même lien.
    expect((await resetPassword(token, 'encore une autre phrase')).body).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('refuse un lien expiré, le GET à jeton, un jeton en paramètre et une empreinte lue en base', async () => {
    const user = await signUp();
    await requestReset(auth, user.email);
    const token = lastToken();
    const [stored] = await resetIdentifiers(user.id);
    const digest = stored!.slice('reset-password:'.length);

    expect((await resetPassword(digest)).body).toMatchObject({ code: 'INVALID_TOKEN' });
    const inQuery = await auth.handler(new Request(`${ORIGIN}/api/auth/reset-password?token=${token}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword: NEW_PASSWORD }),
    }));
    expect(inQuery.status).toBe(400);
    expect(await inQuery.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    const viaGet = await call(auth, `/reset-password/${token}?callbackURL=%2F`);
    expect(viaGet.status).toBe(404);
    expect(await resetIdentifiers(user.id)).toEqual([stored]);

    await admin.db.execute(sql`
      UPDATE verifications SET expires_at = now() - interval '1 second'
      WHERE value = ${user.id} AND identifier LIKE 'reset-password:%'`);
    expect((await resetPassword(token)).body).toMatchObject({ code: 'INVALID_TOKEN' });
    const signIn = await call(auth, '/sign-in/email', { body: { email: user.email, password: OLD_PASSWORD } });
    expect(signIn.status).toBe(200);
  });

  it('révoque les sessions même si le crochet d’après réinitialisation échoue', async () => {
    const user = await signUp();
    const unavailable = new Proxy({}, {
      get() {
        throw new Error('base indisponible');
      },
    }) as unknown as Db;
    const sealer = createOutboxSealer(OUTBOX_KEY);
    const working = createPasswordResetHooks({ db: authHandle.db, sealer: () => sealer });
    const failing = createPasswordResetHooks({ db: unavailable, sealer: () => sealer });
    const fragile = makeAuth({
      enqueuePasswordReset: working.enqueuePasswordReset,
      afterPasswordReset: failing.afterPasswordReset,
    });

    await requestReset(fragile, user.email);
    const logged = logs.length;
    const done = await call(fragile, '/reset-password', { body: { token: lastToken(), newPassword: NEW_PASSWORD } });
    expect(done.status).toBe(200);
    const [{ n } = { n: -1 }] = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${user.id}`);
    expect(n).toBe(0);
    expect((await call(fragile, '/get-session', { cookie: user.cookie })).body).toBeNull();
    const failures = logs.slice(logged).join('\n');
    expect(failures).toContain('purge des jetons et sessions impossible');
    expect(failures).toContain('journal d’audit non écrit');
    expect(failures).not.toContain('base indisponible');
  });

  it('sans clé de scellement, n’envoie rien et efface le jeton émis', async () => {
    const user = await signUp();
    const disabled = makeAuth(createPasswordResetHooks({ db: authHandle.db, sealer: () => null }));
    const res = await requestReset(disabled, user.email);
    expect(res.status).toBe(200);
    expect(await resetIdentifiers(user.id)).toEqual([]);
    expect(await outbox(user.id)).toEqual([]);
  });

  it('n’active pas le cache de session en cookie', async () => {
    const options = buildAuthOptions({
      db: authHandle.db, baseURL: ORIGIN, secret: 'x'.repeat(32),
      passwordReset: { enqueuePasswordReset: async () => {}, afterPasswordReset: async () => {} },
    });
    expect(options).not.toHaveProperty('session');
    const context = await auth.$context;
    const effective: BetterAuthOptions = context.options;
    expect(effective.session?.cookieCache?.enabled ?? false).toBe(false);
    expect(options.emailAndPassword).toMatchObject({
      resetPasswordTokenExpiresIn: 1800, revokeSessionsOnPasswordReset: true, minPasswordLength: 12, maxPasswordLength: 128,
    });
  });

  // Better Auth accepte trustDevice sur verify-totp quel que soit le réglage :
  // la garantie est la purge des lignes trust-device-* à la réinitialisation.
  it('après réinitialisation, un appareil de confiance enregistré avant ne dispense plus du TOTP', async () => {
    const user = await signUp();
    const enabled = await call(auth, '/two-factor/enable', { body: { password: OLD_PASSWORD }, cookie: user.cookie });
    expect(enabled.status).toBe(200);
    const { totpURI } = enabled.body as { totpURI: string };
    const activated = await call(auth, '/two-factor/verify-totp', { body: { code: totp(totpURI) }, cookie: user.cookie });
    expect(activated.status).toBe(200);

    const challenge = await call(auth, '/sign-in/email', { body: { email: user.email, password: OLD_PASSWORD } });
    expect(challenge.body).toMatchObject({ twoFactorRedirect: true });
    const trusted = await call(auth, '/two-factor/verify-totp', {
      body: { code: totp(totpURI), trustDevice: true }, cookie: challenge.cookie,
    });
    expect(trusted.status).toBe(200);
    const trustCookie = trustDeviceCookie(trusted.cookie);
    expect(trustCookie).not.toBe('');

    // Avant la réinitialisation, ce cookie dispense bien du second facteur.
    const skipped = await call(auth, '/sign-in/email', {
      body: { email: user.email, password: OLD_PASSWORD }, cookie: trustCookie,
    });
    expect(skipped.status).toBe(200);
    expect(skipped.body).not.toHaveProperty('twoFactorRedirect');
    const renewed = trustDeviceCookie(skipped.cookie);
    expect(renewed).not.toBe('');

    await requestReset(auth, user.email);
    expect((await resetPassword(lastToken())).status).toBe(200);
    await flush();

    const after = await call(auth, '/sign-in/email', {
      body: { email: user.email, password: NEW_PASSWORD }, cookie: renewed,
    });
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ twoFactorRedirect: true });
    expect(after.body).not.toHaveProperty('token');
  });

  it('base indisponible : 500 au format attendu, sans adresse dans les journaux', async () => {
    const email = 'victime@meridiane-logistics.example';
    emails.push(email);
    const unreachable = createDb('postgres://toron:toron@127.0.0.1:1/toron');
    try {
      const broken = betterAuth(buildAuthOptions({
        db: unreachable.db, baseURL: ORIGIN, secret: 'secret_de_test_better_auth_32_caracteres_min',
        passwordReset: { enqueuePasswordReset: async () => {}, afterPasswordReset: async () => {} },
      }));
      let raised: unknown;
      const route = createAuthRoute(() => async (request) => {
        try {
          return await broken.handler(request);
        } catch (err) {
          raised = err;
          throw err;
        }
      });
      const logged = logs.length;
      const res = await route.POST(new Request(`${ORIGIN}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ email, redirectTo: '/mot-de-passe/nouveau' }),
      }));

      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ code: 'ERREUR_INTERNE', correlationId: expect.any(String) });
      // L'erreur remontée cite l'adresse : c'est elle qui ne doit pas atteindre la console.
      expect(stringify(raised)).toContain(email);
      const written = logs.slice(logged).join(' | ');
      expect(written).toContain('[auth] erreur interne');
      expect(written).not.toContain('@');
    } finally {
      await unreachable.close();
    }
  });

  it('le logger Better Auth n’écrit ni adresse, ni jeton, ni les arguments', () => {
    const options = buildAuthOptions({
      db: authHandle.db, baseURL: ORIGIN, secret: 'x'.repeat(32),
      passwordReset: { enqueuePasswordReset: async () => {}, afterPasswordReset: async () => {} },
    });
    // Signature appelée par Better Auth : message puis arguments.
    const log: (level: 'error', message: unknown, ...args: unknown[]) => void = options.logger.log;
    const logged = logs.length;
    const secret = 'AbCdEfGhIjKlMnOpQrStUvWx';
    log('error', `échec pour jean.dupont@exemple.fr jeton ${secret}`, new Error('cause jean.dupont@exemple.fr'));
    // Better Auth passe parfois un objet d'erreur en guise de message.
    log('error', new Error('Failed query: params: jean.dupont@exemple.fr'));
    const written = logs.slice(logged).join(' | ');
    expect(written).toContain('[auth]');
    expect(written).not.toContain('@');
    expect(written).not.toContain(secret);
    expect(written).not.toContain('cause');
    expect(written).not.toContain('Failed query');
  });

  it('n’écrit dans la console ni adresse ni jeton', () => {
    expect(tokens.length).toBeGreaterThan(5);
    const all = logs.join('\n');
    expect(all).toContain('[courriel]');
    expect(all).not.toContain('@');
    for (const email of emails) expect(all.toLowerCase()).not.toContain(email.toLowerCase());
    for (const token of tokens) expect(all).not.toContain(token);
  });
});
