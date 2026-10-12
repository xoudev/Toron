import { randomBytes, randomUUID } from 'node:crypto';

import { ACCOUNT_EMAIL_QUOTAS, resetIdentifierStorage } from '@toron/core';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeAuditEntry } from '../audit.ts';
import { createDb, type DbHandle } from '../client.ts';
import * as schema from '../schema/index.ts';
import { withTenant } from '../tenant.ts';
import { startTestDatabase, type TestDatabase } from '../testing.ts';
import { verifyAuditChain } from './audit.ts';
import {
  cleanupAfterPasswordReset,
  discardPasswordResetToken,
  listUserTenantIds,
  queuePasswordResetEmail,
  recordPasswordReset,
} from './account-security.ts';

/**
 * Sécurité du compte après « mot de passe oublié », sous les rôles réels :
 * toron_auth dépose et purge, toron_app relit le journal de chaque
 * organisation. Les lignes verifications imitent celles de Better Auth
 * (identifiant haché préfixé, value = identifiant utilisateur).
 */

let db: TestDatabase<'app' | 'auth'>;
let admin: postgres.Sql;
let auth: DbHandle;
let app: DbHandle;
let userCount = 0;

beforeAll(async () => {
  db = await startTestDatabase({ logins: ['app', 'auth'] });
  admin = postgres(db.adminUri, { max: 1, onnotice: () => {} });
  auth = createDb(db.uris.auth);
  app = createDb(db.uris.app);
});

afterAll(async () => {
  await auth?.close();
  await app?.close();
  await admin?.end();
  await db?.stop();
});

async function newUser(): Promise<{ id: string; email: string }> {
  userCount += 1;
  const email = `compte-${userCount}@meridiane-logistics.example`;
  const [u] = await admin`INSERT INTO users (email) VALUES (${email}) RETURNING id`;
  return { id: (u as { id: string }).id, email };
}

async function newTenant(slug: string): Promise<string> {
  const [t] = await admin`INSERT INTO tenants (name, slug) VALUES (${slug}, ${slug}) RETURNING id`;
  return (t as { id: string }).id;
}

/** Demande de réinitialisation telle que Better Auth la stocke, datée de `secondsAgo`. */
async function resetRequest(userId: string, secondsAgo: number): Promise<{ token: string; stored: string }> {
  const token = randomBytes(18).toString('base64url').replace(/[-_]/g, 'A').slice(0, 24);
  const stored = await resetIdentifierStorage(`reset-password:${token}`);
  await auth.db.insert(schema.verifications).values({
    identifier: stored, value: userId,
    expiresAt: new Date(Date.now() + 1800_000), createdAt: new Date(Date.now() - secondsAgo * 1000),
  });
  return { token, stored };
}

function queue(user: { id: string; email: string }, stored: string) {
  return queuePasswordResetEmail(auth.db, {
    id: randomUUID(), userId: user.id, recipient: user.email, params: {},
    secretBox: randomBytes(64), secretKeyId: 'k0a1b2c3d',
    expiresAt: new Date(Date.now() + 1800_000), correlationId: randomUUID(), storedIdentifier: stored,
  });
}

async function identifiersOf(userId: string): Promise<string[]> {
  const rows = await admin`SELECT identifier FROM verifications WHERE value = ${userId} ORDER BY identifier`;
  return rows.map((r) => (r as { identifier: string }).identifier);
}

async function outboxCount(userId: string): Promise<number> {
  const [r] = await admin`SELECT count(*)::int AS n FROM email_outbox WHERE user_id = ${userId}`;
  return (r as { n: number }).n;
}

describe('queuePasswordResetEmail — seul le plus récent fonctionne', () => {
  it('dépose la demande la plus récente et efface les jetons plus anciens, pas les autres lignes du compte', async () => {
    const user = await newUser();
    await admin`INSERT INTO verifications (identifier, value, expires_at) VALUES ('2fa-defi', ${user.id}, now() + interval '5 minutes')`;
    const older = await resetRequest(user.id, 60);
    const newer = await resetRequest(user.id, 10);

    expect(await queue(user, newer.stored)).toBe('mis_en_file');
    expect(await identifiersOf(user.id)).toEqual(['2fa-defi', newer.stored].sort());
    const [row] = await admin`SELECT tenant_id, kind, recipient, secret_box FROM email_outbox WHERE user_id = ${user.id}`;
    expect(row).toMatchObject({ tenant_id: null, kind: 'mot_de_passe_reinitialisation', recipient: user.email });
    expect((row as { secret_box: Buffer | null }).secret_box).not.toBeNull();

    // La tâche de la demande la plus ancienne arrive après : sa ligne a disparu, rien ne part.
    expect(await queue(user, older.stored)).toBe('remplace');
    expect(await outboxCount(user.id)).toBe(1);
  });

  it('écarte une demande dépassée qui s’exécute avant la plus récente', async () => {
    const user = await newUser();
    const older = await resetRequest(user.id, 60);
    const newer = await resetRequest(user.id, 10);

    expect(await queue(user, older.stored)).toBe('remplace');
    expect(await identifiersOf(user.id)).toEqual([newer.stored]);
    expect(await outboxCount(user.id)).toBe(0);

    expect(await queue(user, newer.stored)).toBe('mis_en_file');
    expect(await identifiersOf(user.id)).toEqual([newer.stored]);
    expect(await outboxCount(user.id)).toBe(1);
  });

  it('ne laisse qu’un jeton et un e-mail quand les deux tâches s’exécutent en même temps', async () => {
    const user = await newUser();
    const older = await resetRequest(user.id, 60);
    const newer = await resetRequest(user.id, 10);

    const [a, b] = await Promise.all([queue(user, older.stored), queue(user, newer.stored)]);
    expect([a, b]).toEqual(['remplace', 'mis_en_file']);
    expect(await identifiersOf(user.id)).toEqual([newer.stored]);
    expect(await outboxCount(user.id)).toBe(1);
  });

  // Le résultat ci-dessus ne dépend pas du verrou du compte ; celui-ci évite
  // l'interblocage décrit dans queuePasswordResetEmail.
  it('attend la fin d’un dépôt en cours pour le même compte', async () => {
    const user = await newUser();
    const request = await resetRequest(user.id, 0);
    let settled = false;
    let pending: Promise<string> | undefined;

    await admin.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`reset-password:${user.id}`}, 0))`;
      pending = queue(user, request.stored).finally(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false);
    });

    expect(await pending).toBe('mis_en_file');
    expect(await outboxCount(user.id)).toBe(1);
  });

  it('une nouvelle demande après un dépôt remplace le jeton déjà envoyé', async () => {
    const user = await newUser();
    const first = await resetRequest(user.id, 30);
    expect(await queue(user, first.stored)).toBe('mis_en_file');
    const second = await resetRequest(user.id, 0);
    expect(await queue(user, second.stored)).toBe('mis_en_file');
    expect(await identifiersOf(user.id)).toEqual([second.stored]);
    expect(await outboxCount(user.id)).toBe(2);
  });

  it('respecte le quota horaire et supprime le jeton refusé, l’e-mail précédent restant valable', async () => {
    const user = await newUser();
    const { perHour } = ACCOUNT_EMAIL_QUOTAS.mot_de_passe_reinitialisation;
    let last = '';
    for (let i = 0; i < perHour; i += 1) {
      last = (await resetRequest(user.id, 100 - i)).stored;
      expect(await queue(user, last)).toBe('mis_en_file');
    }
    const refused = await resetRequest(user.id, 0);
    expect(await queue(user, refused.stored)).toBe('quota_compte');
    expect(await identifiersOf(user.id)).toEqual([last]);
    expect(await outboxCount(user.id)).toBe(perHour);
  });
});

describe('discardPasswordResetToken', () => {
  it('n’efface que le jeton désigné, et seulement pour son compte', async () => {
    const user = await newUser();
    const other = await newUser();
    const kept = await resetRequest(user.id, 30);
    const dropped = await resetRequest(user.id, 0);

    expect(await discardPasswordResetToken(auth.db, { userId: other.id, storedIdentifier: dropped.stored })).toBe(0);
    expect(await discardPasswordResetToken(auth.db, { userId: user.id, storedIdentifier: dropped.stored })).toBe(1);
    expect(await identifiersOf(user.id)).toEqual([kept.stored]);
  });
});

describe('cleanupAfterPasswordReset', () => {
  it('purge jetons, défis et sessions du compte, marque l’adresse vérifiée, sans toucher au reste', async () => {
    const user = await newUser();
    const other = await newUser();
    await resetRequest(user.id, 10);
    await resetRequest(other.id, 10);
    // Lignes de l'extension 2FA de Better Auth : le défi et l'appareil de
    // confiance portent value = userId, le compteur d'essais porte le
    // nombre d'essais. Le compteur subsiste donc : sans lien avec le
    // compte, il expire seul et n'ouvre aucun accès.
    await admin`
      INSERT INTO verifications (identifier, value, expires_at) VALUES
        ('2fa-defi-a', ${user.id}, now() + interval '5 minutes'),
        ('trust-device-a', ${user.id}, now() + interval '30 days'),
        ('2fa-attempts-defi-a', '0', now() + interval '5 minutes')`;
    for (const [owner, token] of [[user.id, 'session-a'], [user.id, 'session-b'], [other.id, 'session-c']] as const) {
      await admin`INSERT INTO sessions (user_id, token, expires_at) VALUES (${owner}, ${token}, now() + interval '1 day')`;
    }
    await admin`INSERT INTO two_factors (user_id, secret, backup_codes) VALUES (${user.id}, 'secret-chiffre', 'codes-chiffres')`;
    const [twoFactorBefore] = await admin`SELECT * FROM two_factors WHERE user_id = ${user.id}`;

    expect(await cleanupAfterPasswordReset(auth.db, user.id)).toEqual({ verificationsDeleted: 3, sessionsDeleted: 2 });

    expect(await identifiersOf(user.id)).toEqual([]);
    const [attempts] = await admin`SELECT count(*)::int AS n FROM verifications WHERE identifier = '2fa-attempts-defi-a'`;
    expect((attempts as { n: number }).n).toBe(1);
    expect(await identifiersOf(other.id)).toHaveLength(1);
    const sessions = await admin`SELECT token FROM sessions WHERE user_id IN (${user.id}, ${other.id})`;
    expect(sessions.map((s) => (s as { token: string }).token)).toEqual(['session-c']);
    const [twoFactorAfter] = await admin`SELECT * FROM two_factors WHERE user_id = ${user.id}`;
    expect(twoFactorAfter).toEqual(twoFactorBefore);

    const [verified] = await auth.db.select({ v: schema.users.emailVerified }).from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(verified?.v).toBe(true);
    const [untouched] = await auth.db.select({ v: schema.users.emailVerified }).from(schema.users)
      .where(eq(schema.users.id, other.id));
    expect(untouched?.v).toBe(false);
  });
});

describe('recordPasswordReset', () => {
  it('écrit une entrée par organisation du compte, chaîne intacte, et rien ailleurs', async () => {
    const user = await newUser();
    const tenantA = await newTenant('reinit-a');
    const tenantB = await newTenant('reinit-b');
    const tenantC = await newTenant('reinit-c');
    for (const t of [tenantA, tenantB]) {
      await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${t}, ${user.id}, 'lecteur')`;
    }
    // Journal déjà entamé dans A : l'entrée doit s'y chaîner à la suite.
    await withTenant(app.db, tenantA, (tx) => writeAuditEntry(tx, {
      tenantId: tenantA, action: 'risk.create', objectType: 'risk',
    }));

    expect(new Set(await listUserTenantIds(auth.db, user.id))).toEqual(new Set([tenantA, tenantB]));
    expect(await recordPasswordReset(auth.db, { userId: user.id, ip: '203.0.113.7', userAgent: 'Firefox' })).toBe(2);

    for (const [tenant, entries] of [[tenantA, 2], [tenantB, 1]] as const) {
      const rows = await admin`
        SELECT actor_user_id, object_type, object_id, host(ip) AS ip, user_agent FROM audit_log
        WHERE tenant_id = ${tenant} AND action = 'account.password_reset'`;
      expect([...rows]).toEqual([{
        actor_user_id: user.id, object_type: 'account', object_id: user.id, ip: '203.0.113.7', user_agent: 'Firefox',
      }]);
      expect(await withTenant(app.db, tenant, (tx) => verifyAuditChain(tx)))
        .toMatchObject({ entries, intact: true, brokenAtSeq: null });
    }
    const [none] = await admin`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${tenantC}`;
    expect((none as { n: number }).n).toBe(0);
  });

  it('n’écrit rien pour un compte sans organisation', async () => {
    const user = await newUser();
    expect(await recordPasswordReset(auth.db, { userId: user.id })).toBe(0);
  });
});
