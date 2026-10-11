import { randomBytes, randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ACCOUNT_EMAIL_QUOTAS } from '@toron/core';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { PG_IMAGE } from '../test-image.ts';
import {
  claimNextEmail,
  emailOutboxHealth,
  enqueueAccountEmail,
  markEmailFailed,
  markEmailSent,
  purgeEmailOutbox,
  releaseEmail,
  type AccountEmailKind,
  type ClaimEmailOptions,
} from './email-outbox.ts';
import { exportedTableNames } from './tenant-export.ts';

/**
 * File d'envoi des e-mails (migration 0041) — gate de merge.
 * Rôles réels : toron_app ne voit rien, toron_auth ne fait que déposer,
 * toron_mail ne passe que par ses fonctions. Quotas, baux et effacement du
 * secret sont vérifiés contre le moteur déployé (testcontainers).
 */

/** Le message Postgres d'origine vit dans la chaîne `cause` des erreurs Drizzle. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const messages: string[] = [];
    let cur: unknown = e;
    while (cur instanceof Error) {
      messages.push(cur.message);
      cur = cur.cause;
    }
    expect(messages.join(' | ')).toMatch(pattern);
    return;
  }
  expect.fail('La requête aurait dû être rejetée par Postgres, elle a réussi.');
}

const CLAIM: ClaimEmailOptions = { leaseSeconds: 120, minMarginSeconds: 300, maxAttempts: 6 };
const KEY_ID = 'k0a1b2c3d';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let appSql: postgres.Sql;
let authSql: postgres.Sql;
let mailSql: postgres.Sql;
let auth: DbHandle;
let mail: DbHandle;
let tenantA: string;
let userCount = 0;

function loginUri(login: string): string {
  return `postgres://${login}:${login}_test@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
}

async function newUser(): Promise<string> {
  userCount += 1;
  const [u] = await admin`INSERT INTO users (email) VALUES (${`compte-${userCount}@meridiane.example`}) RETURNING id`;
  return (u as { id: string }).id;
}

function enqueue(
  userId: string,
  kind: AccountEmailKind = 'mot_de_passe_reinitialisation',
  over: { expiresInSeconds?: number; secretBox?: Uint8Array | null } = {},
) {
  const secretBox = over.secretBox === undefined ? randomBytes(64) : over.secretBox;
  return enqueueAccountEmail(auth.db, {
    id: randomUUID(),
    kind,
    userId,
    recipient: `compte-${userId.slice(0, 8)}@meridiane.example`,
    params: { prenom: 'Claire' },
    secretBox,
    secretKeyId: secretBox === null ? null : KEY_ID,
    expiresAt: new Date(Date.now() + (over.expiresInSeconds ?? 1800) * 1000),
    correlationId: randomUUID(),
  });
}

/** Lignes passées, déjà envoyées, posées directement (superutilisateur). */
async function insertPast(userId: string, kind: AccountEmailKind, hoursAgo: number, count: number): Promise<void> {
  await admin`
    INSERT INTO email_outbox (id, kind, user_id, recipient, status, expires_at, correlation_id, created_at)
    SELECT gen_random_uuid(), ${kind}, ${userId}, 'historique@meridiane.example', 'envoye',
           now() - make_interval(hours => ${hoursAgo}::int) + interval '30 minutes', gen_random_uuid(),
           now() - make_interval(hours => ${hoursAgo}::int)
    FROM generate_series(1, ${count}::int)`;
}

async function row(id: string) {
  const [r] = await admin`
    SELECT tenant_id, status, attempts, secret_box, lease_token, sent_at, not_before, last_error_code
    FROM email_outbox WHERE id = ${id}`;
  return r as {
    tenant_id: string | null; status: string; attempts: number; secret_box: Buffer | null;
    lease_token: string | null; sent_at: Date | null; not_before: Date; last_error_code: string | null;
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_IMAGE).start();
  await applyMigrations(container.getConnectionUri());
  admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} });
  for (const [login, role] of [['app_login', 'toron_app'], ['auth_login', 'toron_auth'], ['mail_login', 'toron_mail']] as const) {
    await admin.unsafe(`CREATE ROLE ${login} LOGIN PASSWORD '${login}_test'`);
    await admin.unsafe(`GRANT ${role} TO ${login}`);
  }
  appSql = postgres(loginUri('app_login'), { max: 1, onnotice: () => {} });
  authSql = postgres(loginUri('auth_login'), { max: 1, onnotice: () => {} });
  mailSql = postgres(loginUri('mail_login'), { max: 1, onnotice: () => {} });
  auth = createDb(loginUri('auth_login'));
  mail = createDb(loginUri('mail_login'));

  const [t] = await admin`INSERT INTO tenants (name, slug) VALUES ('Meridiane Logistics', 'meridiane-logistics') RETURNING id`;
  tenantA = (t as { id: string }).id;
});

afterAll(async () => {
  await auth?.close();
  await mail?.close();
  await appSql?.end();
  await authSql?.end();
  await mailSql?.end();
  await admin?.end();
  await container?.stop();
});

beforeEach(async () => {
  await admin`DELETE FROM email_outbox`;
});

describe('droits sur email_outbox', () => {
  it('reste hors de l’export des données d’une organisation (aucune table Drizzle)', () => {
    expect(exportedTableNames()).not.toContain('email_outbox');
  });

  it('toron_app ne lit ni n’insère rien, même dans le contexte de son organisation', async () => {
    await enqueue(await newUser());
    // Comme withTenant : transaction avec le contexte de l'organisation A.
    const asTenantA = (query: string) =>
      appSql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        return tx.unsafe(query);
      });
    for (const column of ['count(*)', 'secret_box', 'recipient', 'id']) {
      await expect(asTenantA(`SELECT ${column} FROM email_outbox`)).rejects.toThrow(/permission denied/);
    }
    await expect(asTenantA(`
      INSERT INTO email_outbox (id, tenant_id, kind, recipient, expires_at, correlation_id)
      VALUES (gen_random_uuid(), '${tenantA}', 'mot_de_passe_reinitialisation', 'claire.morel@meridiane.example',
              now() + interval '30 minutes', gen_random_uuid())`)).rejects.toThrow(/permission denied/);
    await expect(appSql`SELECT * FROM claim_next_email(interval '2 minutes', interval '5 minutes', 6)`).rejects.toThrow(
      /permission denied/,
    );
    await expect(appSql`SELECT * FROM email_outbox_health()`).rejects.toThrow(/permission denied/);
  });

  it('la politique tenant_isolation masque les e-mails de compte quand toron_app recevra des droits', async () => {
    await enqueue(await newUser());
    const seen = await admin
      .begin(async (tx) => {
        await tx`GRANT SELECT ON email_outbox TO toron_app`;
        await tx`SET LOCAL ROLE toron_app`;
        await tx`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        const [c] = await tx`SELECT count(*)::int AS n FROM email_outbox`;
        // Annule le GRANT : la base garde l'état de la migration.
        throw Object.assign(new Error('annulation'), { seen: (c as { n: number }).n });
      })
      .catch((e: unknown) => (e as { seen?: number }).seen);
    expect(seen).toBe(0);
    const [grants] = await admin`SELECT has_table_privilege('toron_app', 'email_outbox', 'SELECT') AS ok`;
    expect((grants as { ok: boolean }).ok).toBe(false);
  });

  it('toron_auth ne lit ni n’insère directement ; la fonction impose tenant_id NULL', async () => {
    await expect(authSql`SELECT * FROM email_outbox`).rejects.toThrow(/permission denied/);
    await expect(authSql`
      INSERT INTO email_outbox (id, kind, recipient, expires_at, correlation_id)
      VALUES (gen_random_uuid(), 'mot_de_passe_reinitialisation', 'claire.morel@meridiane.example',
              now() + interval '30 minutes', gen_random_uuid())`).rejects.toThrow(/permission denied/);
    await expect(authSql`SELECT * FROM claim_next_email(interval '2 minutes', interval '5 minutes', 6)`).rejects.toThrow(
      /permission denied/,
    );

    const user = await newUser();
    expect(await enqueue(user)).toBe('mis_en_file');
    const [r] = await admin`SELECT tenant_id, status, user_id FROM email_outbox`;
    expect(r).toEqual({ tenant_id: null, status: 'a_envoyer', user_id: user });
  });

  it('enqueue_account_email refuse un autre type, un compte absent ou une expiration hors des 24 heures', async () => {
    const user = await newUser();
    const at = new Date(Date.now() + 1800_000).toISOString();
    await expect(authSql`
      SELECT enqueue_account_email(gen_random_uuid(), 'invitation', ${user}::uuid, 'claire.morel@meridiane.example',
        '{}'::jsonb, NULL, NULL, ${at}::timestamptz, gen_random_uuid())`).rejects.toThrow(/courriel_type_invalide/);
    await expect(authSql`
      SELECT enqueue_account_email(gen_random_uuid(), 'mot_de_passe_modifie', NULL, 'claire.morel@meridiane.example',
        '{}'::jsonb, NULL, NULL, ${at}::timestamptz, gen_random_uuid())`).rejects.toThrow(/courriel_compte_requis/);
    await expectDbError(enqueue(user, 'mot_de_passe_reinitialisation', { expiresInSeconds: 25 * 3600 }), /courriel_expiration_invalide/);
    await expectDbError(enqueue(user, 'mot_de_passe_reinitialisation', { expiresInSeconds: -60 }), /courriel_expiration_invalide/);
  });

  it('toron_mail ne lit ni email_outbox ni users, mais exécute ses fonctions', async () => {
    await expect(mailSql`SELECT * FROM email_outbox`).rejects.toThrow(/permission denied/);
    await expect(mailSql`SELECT * FROM users`).rejects.toThrow(/permission denied/);
    const at = new Date(Date.now() + 1800_000).toISOString();
    await expect(mailSql`
      SELECT enqueue_account_email(gen_random_uuid(), 'mot_de_passe_modifie', gen_random_uuid(), 'claire.morel@meridiane.example',
        '{}'::jsonb, NULL, NULL, ${at}::timestamptz, gen_random_uuid())`).rejects.toThrow(/permission denied/);

    await enqueue(await newUser());
    const claimed = await claimNextEmail(mail.db, CLAIM);
    expect(claimed).not.toBeNull();
    expect(await markEmailSent(mail.db, claimed!.id, claimed!.leaseToken, 'tem-0001')).toBe(true);
    expect(await purgeEmailOutbox(mail.db, 30)).toBe(0);
    expect(await emailOutboxHealth(mail.db)).toEqual([
      {
        kind: 'mot_de_passe_reinitialisation', status: 'envoye', lastErrorCode: null, count: 1, countLastHour: 1,
        oldestPendingSeconds: null,
      },
    ]);
  });

  it('chaque fonction SECURITY DEFINER place pg_temp en dernier dans son search_path', async () => {
    const fns = (await admin`
      SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p
      WHERE p.proname IN ('enqueue_account_email', 'claim_next_email', 'mark_email_sent', 'mark_email_failed',
                          'release_email', 'purge_email_outbox', 'email_outbox_health')`) as unknown as {
      proname: string; prosecdef: boolean; proconfig: string[] | null;
    }[];
    expect(fns).toHaveLength(7);
    for (const fn of fns) {
      expect(fn.prosecdef).toBe(true);
      expect(fn.proconfig).toContain('search_path=pg_catalog, public, pg_temp');
    }
  });
});

describe('quotas des e-mails de compte (miroir de ACCOUNT_EMAIL_QUOTAS)', () => {
  const reset = ACCOUNT_EMAIL_QUOTAS.mot_de_passe_reinitialisation;
  const changed = ACCOUNT_EMAIL_QUOTAS.mot_de_passe_modifie;

  it(`réinitialisation : ${reset.perHour} par heure, refus au suivant`, async () => {
    const user = await newUser();
    for (let i = 0; i < reset.perHour; i += 1) expect(await enqueue(user)).toBe('mis_en_file');
    expect(await enqueue(user)).toBe('quota_compte');
    // Le quota est propre au compte et au type.
    expect(await enqueue(await newUser())).toBe('mis_en_file');
    expect(await enqueue(user, 'mot_de_passe_modifie')).toBe('mis_en_file');
  });

  it(`réinitialisation : ${reset.perDay} par 24 heures, au-delà de l'heure courante`, async () => {
    const user = await newUser();
    await insertPast(user, 'mot_de_passe_reinitialisation', 2, reset.perDay - 1);
    await insertPast(user, 'mot_de_passe_reinitialisation', 25, 10);
    expect(await enqueue(user)).toBe('mis_en_file');
    expect(await enqueue(user)).toBe('quota_compte');
  });

  it(`mot de passe modifié : ${changed.perDay} par 24 heures, sans plafond horaire`, async () => {
    const user = await newUser();
    for (let i = 0; i < changed.perDay; i += 1) expect(await enqueue(user, 'mot_de_passe_modifie')).toBe('mis_en_file');
    expect(await enqueue(user, 'mot_de_passe_modifie')).toBe('quota_compte');
  });

  it('des dépôts simultanés sur un compte ne franchissent pas le quota (verrou consultatif)', async () => {
    const user = await newUser();
    const results = await Promise.all(Array.from({ length: 8 }, () => enqueue(user)));
    expect(results.filter((r) => r === 'mis_en_file')).toHaveLength(reset.perHour);
    expect(results.filter((r) => r === 'quota_compte')).toHaveLength(8 - reset.perHour);
  });

  it(`plafond global : ${ACCOUNT_EMAIL_QUOTAS.globalPerHour} e-mails de compte par heure`, async () => {
    const [u] = await admin`SELECT id FROM users LIMIT 1`;
    const other = (u as { id: string }).id;
    await admin`
      INSERT INTO email_outbox (id, kind, user_id, recipient, status, expires_at, correlation_id)
      SELECT gen_random_uuid(), 'mot_de_passe_modifie', ${other}, 'historique@meridiane.example', 'envoye',
             now() + interval '30 minutes', gen_random_uuid()
      FROM generate_series(1, ${ACCOUNT_EMAIL_QUOTAS.globalPerHour - 1}::int)`;
    expect(await enqueue(await newUser())).toBe('mis_en_file');
    expect(await enqueue(await newUser())).toBe('quota_global');
  });
});

describe('cycle de vie d’un e-mail dans la file', () => {
  it('réclame avec bail et secret, puis clôt l’envoi en effaçant le secret', async () => {
    const box = randomBytes(48);
    await enqueue(await newUser(), 'mot_de_passe_reinitialisation', { secretBox: box });
    const claimed = await claimNextEmail(mail.db, CLAIM);
    expect(claimed).toMatchObject({ kind: 'mot_de_passe_reinitialisation', attempts: 1, secretKeyId: KEY_ID, params: { prenom: 'Claire' } });
    expect(claimed!.secretBox?.equals(box)).toBe(true);
    expect(await claimNextEmail(mail.db, CLAIM)).toBeNull();

    expect(await markEmailSent(mail.db, claimed!.id, claimed!.leaseToken, 'tem-0002')).toBe(true);
    const r = await row(claimed!.id);
    expect(r).toMatchObject({ status: 'envoye', secret_box: null, lease_token: null });
    expect(r.sent_at).toBeInstanceOf(Date);
    // Une seconde clôture avec le même bail ne trouve plus rien.
    expect(await markEmailSent(mail.db, claimed!.id, claimed!.leaseToken, 'tem-0002')).toBe(false);
  });

  it('des réclamations simultanées obtiennent des lignes distinctes', async () => {
    for (let i = 0; i < 6; i += 1) await enqueue(await newUser());
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimNextEmail(mail.db, CLAIM)));
    const ids = claims.filter((c) => c !== null).map((c) => c!.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('reprend une ligne au bail échu ; l’ancien bail ne clôt plus rien', async () => {
    await enqueue(await newUser());
    const first = await claimNextEmail(mail.db, CLAIM);
    await admin`UPDATE email_outbox SET claimed_at = now() - interval '10 minutes' WHERE id = ${first!.id}`;

    const second = await claimNextEmail(mail.db, CLAIM);
    expect(second?.id).toBe(first!.id);
    expect(second?.leaseToken).not.toBe(first!.leaseToken);
    expect(second?.attempts).toBe(2);

    expect(await markEmailSent(mail.db, first!.id, first!.leaseToken, 'tem-0003')).toBe(false);
    expect(await markEmailFailed(mail.db, first!.id, first!.leaseToken, 'RESEAU', null)).toBeNull();
    expect(await releaseEmail(mail.db, first!.id, first!.leaseToken)).toBe(false);
    expect((await row(first!.id)).status).toBe('en_cours');
    expect(await markEmailSent(mail.db, second!.id, second!.leaseToken, 'tem-0003')).toBe(true);
  });

  it('fait expirer, secret effacé, une ligne qui ne peut plus partir à temps', async () => {
    await enqueue(await newUser(), 'mot_de_passe_reinitialisation', { expiresInSeconds: 600 });
    const [{ id }] = (await admin`SELECT id FROM email_outbox`) as unknown as [{ id: string }];
    expect(await claimNextEmail(mail.db, { ...CLAIM, minMarginSeconds: 900 })).toBeNull();
    expect(await row(id)).toMatchObject({ status: 'expire', secret_box: null, last_error_code: 'DELAI_DEPASSE' });
  });

  it('refuse par contrainte CHECK un statut final qui garderait le secret', async () => {
    await enqueue(await newUser());
    await expect(admin`UPDATE email_outbox SET status = 'envoye'`).rejects.toThrow(/email_outbox_secret_wiped/);
    await expect(admin`UPDATE email_outbox SET status = 'echec'`).rejects.toThrow(/email_outbox_secret_wiped/);
  });

  it('release_email rend la ligne sans consommer de tentative', async () => {
    await enqueue(await newUser());
    const claimed = await claimNextEmail(mail.db, CLAIM);
    expect(await releaseEmail(mail.db, claimed!.id, claimed!.leaseToken)).toBe(true);
    expect(await row(claimed!.id)).toMatchObject({ status: 'a_envoyer', attempts: 0, lease_token: null });
    expect((await row(claimed!.id)).secret_box).not.toBeNull();
    expect((await claimNextEmail(mail.db, CLAIM))?.attempts).toBe(1);
  });

  it('un échec repousse, expire ou clôt selon la date de reprise', async () => {
    await enqueue(await newUser());
    let claimed = await claimNextEmail(mail.db, CLAIM);
    const retryAt = new Date(Date.now() + 600_000);
    expect(await markEmailFailed(mail.db, claimed!.id, claimed!.leaseToken, 'FOURNISSEUR_INDISPONIBLE', retryAt)).toBe('a_envoyer');
    const pushed = await row(claimed!.id);
    expect(pushed).toMatchObject({ status: 'a_envoyer', last_error_code: 'FOURNISSEUR_INDISPONIBLE', lease_token: null });
    expect(pushed.secret_box).not.toBeNull();
    expect(pushed.not_before.getTime()).toBe(retryAt.getTime());
    expect(await claimNextEmail(mail.db, CLAIM)).toBeNull();

    await admin`UPDATE email_outbox SET not_before = now()`;
    claimed = await claimNextEmail(mail.db, CLAIM);
    expect(await markEmailFailed(mail.db, claimed!.id, claimed!.leaseToken, 'REFUS_FOURNISSEUR', null)).toBe('echec');
    expect(await row(claimed!.id)).toMatchObject({ status: 'echec', secret_box: null, last_error_code: 'REFUS_FOURNISSEUR' });

    await enqueue(await newUser());
    claimed = await claimNextEmail(mail.db, CLAIM);
    const late = new Date(Date.now() + 3600_000);
    expect(await markEmailFailed(mail.db, claimed!.id, claimed!.leaseToken, 'LIMITE_FOURNISSEUR', late)).toBe('expire');
    expect(await row(claimed!.id)).toMatchObject({ status: 'expire', secret_box: null, last_error_code: 'DELAI_DEPASSE' });
  });

  it('une reprise fixée exactement à l’expiration fait expirer la ligne', async () => {
    await enqueue(await newUser());
    const claimed = await claimNextEmail(mail.db, CLAIM);
    // Valeur relue en base, comme le service quand aucune reprise ne tient avant la marge.
    expect(await markEmailFailed(mail.db, claimed!.id, claimed!.leaseToken, 'RESEAU', claimed!.expiresAt)).toBe('expire');
    expect(await row(claimed!.id)).toMatchObject({ status: 'expire', secret_box: null, last_error_code: 'DELAI_DEPASSE' });
  });

  it('passe en échec une ligne qui a épuisé ses tentatives', async () => {
    await enqueue(await newUser());
    const once = { ...CLAIM, maxAttempts: 1 };
    const claimed = await claimNextEmail(mail.db, once);
    expect(await markEmailFailed(mail.db, claimed!.id, claimed!.leaseToken, 'RESEAU', new Date(Date.now() - 1000))).toBe('a_envoyer');
    expect(await claimNextEmail(mail.db, once)).toBeNull();
    expect(await row(claimed!.id)).toMatchObject({ status: 'echec', secret_box: null, last_error_code: 'TENTATIVES_EPUISEES', attempts: 1 });
  });

  it('purge les lignes finales au-delà de la rétention, jamais avant 7 jours ni en attente', async () => {
    const user = await newUser();
    await insertPast(user, 'mot_de_passe_modifie', 8 * 24, 2);
    await insertPast(user, 'mot_de_passe_modifie', 6 * 24, 3);
    await enqueue(user);
    await admin`UPDATE email_outbox SET created_at = now() - interval '9 days' WHERE status = 'a_envoyer'`;

    expect(await purgeEmailOutbox(mail.db, 1)).toBe(2);
    const left = (await admin`SELECT status, count(*)::int AS n FROM email_outbox GROUP BY status ORDER BY status`) as unknown as {
      status: string; n: number;
    }[];
    expect(left).toEqual([{ status: 'a_envoyer', n: 1 }, { status: 'envoye', n: 3 }]);
  });

  it('respecte une rétention supérieure au plancher', async () => {
    const user = await newUser();
    await insertPast(user, 'mot_de_passe_modifie', 31 * 24, 2);
    await insertPast(user, 'mot_de_passe_modifie', 20 * 24, 3);
    await insertPast(user, 'mot_de_passe_modifie', 8 * 24, 4);

    expect(await purgeEmailOutbox(mail.db, 30)).toBe(2);
    expect(await purgeEmailOutbox(mail.db, 30)).toBe(0);
    expect(await purgeEmailOutbox(mail.db, 1)).toBe(7);
  });

  it('les agrégats de supervision ne contiennent aucune adresse', async () => {
    await enqueue(await newUser());
    await enqueue(await newUser(), 'mot_de_passe_modifie');
    const health = await emailOutboxHealth(mail.db);
    expect(health).toHaveLength(2);
    expect(health.every((h) => h.status === 'a_envoyer' && h.count === 1 && h.oldestPendingSeconds !== null)).toBe(true);
    expect(JSON.stringify(health)).not.toContain('@');
  });

  it('compte les expirations de la dernière heure, y compris celles décidées à la réclamation', async () => {
    await enqueue(await newUser(), 'mot_de_passe_reinitialisation', { expiresInSeconds: 600 });
    expect(await claimNextEmail(mail.db, { ...CLAIM, minMarginSeconds: 900 })).toBeNull();
    const health = await emailOutboxHealth(mail.db);
    expect(health).toEqual([
      {
        kind: 'mot_de_passe_reinitialisation', status: 'expire', lastErrorCode: 'DELAI_DEPASSE', count: 1, countLastHour: 1,
        oldestPendingSeconds: null,
      },
    ]);
    // Le trigger set_updated_at réécrirait la date : réplication locale pour le contourner.
    await admin.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE email_outbox SET updated_at = now() - interval '2 hours'`;
    });
    expect((await emailOutboxHealth(mail.db))[0]?.countLastHour).toBe(0);
  });
});
