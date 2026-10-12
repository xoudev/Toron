import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  normalizeEmail, normalizeIp, PASSWORD_CHANGED_NOTICE_TTL_SECONDS, PASSWORD_RESET_TTL_SECONDS,
  RESET_TOKEN_PATTERN, resetIdentifierStorage,
} from '@toron/core';
import {
  cleanupAfterPasswordReset, discardPasswordResetToken, enqueueAccountEmail, queuePasswordResetEmail,
  recordPasswordReset, type Db,
} from '@toron/db';

import { errorCode, logAccountEmail, type AccountEmailEvent, type OutboxSealer } from './email-outbox.ts';

// Crochets « mot de passe oublié » appelés par Better Auth. Ils ne lèvent
// jamais : le dépôt tourne après la réponse (une exception n'atteindrait
// personne), et une exception dans onPasswordReset empêcherait Better Auth
// de révoquer les sessions. Chaque échec est journalisé, corrélé et sans
// donnée personnelle.

export interface PasswordResetUser {
  id: string;
  /** Adresse stockée du compte, jamais la saisie du formulaire. */
  email: string;
}

export interface PasswordResetDeps {
  /** Client du rôle d'identité (toron_auth). */
  db: Db;
  /** Null : envoi désactivé (local sans MAIL_OUTBOX_KEY). */
  sealer: () => OutboxSealer | null;
  now?: () => Date;
}

export interface PasswordResetHooks {
  enqueuePasswordReset(input: { user: PasswordResetUser; token: string }): Promise<void>;
  afterPasswordReset(input: { user: PasswordResetUser; request?: Request }): Promise<void>;
}

const QUEUE_EVENTS = {
  mis_en_file: 'reinit_depose',
  remplace: 'reinit_remplace',
  quota_compte: 'reinit_quota_compte',
  quota_global: 'reinit_quota_global',
} as const satisfies Record<string, AccountEmailEvent>;

const NOTICE_EVENTS = {
  mis_en_file: 'modifie_depose',
  quota_compte: 'modifie_quota_compte',
  quota_global: 'modifie_quota_global',
} as const satisfies Record<string, AccountEmailEvent>;

export function createPasswordResetHooks(deps: PasswordResetDeps): PasswordResetHooks {
  const now = deps.now ?? (() => new Date());

  async function enqueuePasswordReset({ user, token }: { user: PasswordResetUser; token: string }): Promise<void> {
    const correlationId = randomUUID();
    try {
      if (!RESET_TOKEN_PATTERN.test(token)) {
        logAccountEmail('reinit_jeton_inattendu', { correlationId });
        return;
      }
      const storedIdentifier = await resetIdentifierStorage(`reset-password:${token}`);
      const sealer = deps.sealer();
      if (!sealer) {
        // Aucun e-mail ne portera ce jeton : il ne doit pas rester valable.
        await discardPasswordResetToken(deps.db, { userId: user.id, storedIdentifier });
        return;
      }
      const id = randomUUID();
      const sealed = sealer.seal({ id, kind: 'mot_de_passe_reinitialisation' }, token);
      const result = await queuePasswordResetEmail(deps.db, {
        id,
        userId: user.id,
        recipient: normalizeEmail(user.email),
        params: {},
        secretBox: sealed.box,
        secretKeyId: sealed.keyId,
        expiresAt: new Date(now().getTime() + PASSWORD_RESET_TTL_SECONDS * 1000),
        correlationId,
        storedIdentifier,
      });
      logAccountEmail(QUEUE_EVENTS[result], { correlationId });
    } catch (err) {
      logAccountEmail('reinit_echec', { correlationId, code: errorCode(err) });
    }
  }

  async function afterPasswordReset({ user, request }: { user: PasswordResetUser; request?: Request }): Promise<void> {
    const correlationId = randomUUID();
    try {
      await cleanupAfterPasswordReset(deps.db, user.id);
    } catch (err) {
      logAccountEmail('modifie_purge_echec', { correlationId, code: errorCode(err) });
    }

    try {
      const organisations = await recordPasswordReset(deps.db, {
        userId: user.id,
        ip: normalizeIp(request?.headers.get('x-forwarded-for') ?? null),
        userAgent: request?.headers.get('user-agent') || undefined,
      });
      logAccountEmail('modifie_audit_ecrit', { correlationId, organisations });
    } catch (err) {
      logAccountEmail('modifie_audit_echec', { correlationId, code: errorCode(err) });
    }

    try {
      if (!deps.sealer()) return;
      const changedAt = now();
      const result = await enqueueAccountEmail(deps.db, {
        id: randomUUID(),
        kind: 'mot_de_passe_modifie',
        userId: user.id,
        recipient: normalizeEmail(user.email),
        params: { modifieLe: changedAt.toISOString() },
        secretBox: null,
        secretKeyId: null,
        expiresAt: new Date(changedAt.getTime() + PASSWORD_CHANGED_NOTICE_TTL_SECONDS * 1000),
        correlationId,
      });
      logAccountEmail(NOTICE_EVENTS[result], { correlationId });
    } catch (err) {
      logAccountEmail('modifie_echec', { correlationId, code: errorCode(err) });
    }
  }

  return { enqueuePasswordReset, afterPasswordReset };
}
