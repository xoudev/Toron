import { and, asc, eq, sql } from 'drizzle-orm';

import { writeAuditEntry } from '../audit.ts';
import type { Db } from '../client.ts';
import * as schema from '../schema/index.ts';
import { withTenant } from '../tenant.ts';
import { enqueueAccountEmail, type EnqueueAccountEmailInput, type EnqueueEmailResult } from './email-outbox.ts';

// ── Sécurité du compte (mot de passe oublié) ────────────────────────────
// Requêtes du rôle d'identité (toron_auth) autour des jetons Better Auth :
// une ligne verifications(identifier = 'reset-password:<empreinte>',
// value = userId) par demande. Aucune ne journalise ni ne renvoie le jeton.

const RESET_IDENTIFIER_PATTERN = 'reset-password:%';

export type QueuePasswordResetResult = EnqueueEmailResult | 'remplace';

export interface QueuePasswordResetInput extends Omit<EnqueueAccountEmailInput, 'kind'> {
  /** Identifiant tel que Better Auth l'a stocké, préfixe compris. */
  storedIdentifier: string;
}

/**
 * Dépose l'e-mail de réinitialisation, en appliquant « seul le plus récent
 * fonctionne » même si les tâches d'arrière-plan s'exécutent dans le
 * désordre. Une demande déjà dépassée (ou dont la ligne a disparu, purgée
 * par une demande plus récente) ne part pas ; une demande refusée par quota
 * perd son jeton ; une demande déposée efface les jetons plus anciens.
 * L'ordre est (created_at, id) : deux demandes de la même milliseconde
 * restent départagées de la même façon par chacune.
 */
export async function queuePasswordResetEmail(db: Db, input: QueuePasswordResetInput): Promise<QueuePasswordResetResult> {
  return db.transaction(async (tx) => {
    // Sérialise les dépôts d'un même compte. Sans cela, quand la demande
    // récente n'existait pas encore à la lecture de l'ancienne, l'ancienne
    // tiendrait sa ligne (FOR UPDATE) en attendant le verrou de la file que
    // tient la récente, laquelle attendrait cette ligne pour l'effacer :
    // interblocage, et l'une des deux échouerait.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reset-password:${input.userId}`}, 0))`);

    const [current] = (await tx.execute(sql`
      SELECT v.id,
             EXISTS (
               SELECT 1 FROM verifications n
               WHERE n.value = v.value AND n.identifier LIKE ${RESET_IDENTIFIER_PATTERN}
                 AND (n.created_at, n.id) > (v.created_at, v.id)
             ) AS superseded
      FROM verifications v
      WHERE v.identifier = ${input.storedIdentifier} AND v.value = ${input.userId}
      FOR UPDATE OF v
    `)) as unknown as { id: string; superseded: boolean }[];
    if (!current) return 'remplace';
    if (current.superseded) {
      await tx.execute(sql`DELETE FROM verifications WHERE id = ${current.id}::uuid`);
      return 'remplace';
    }

    const { storedIdentifier: _stored, ...email } = input;
    const result = await enqueueAccountEmail(tx, { ...email, kind: 'mot_de_passe_reinitialisation' });
    if (result === 'mis_en_file') {
      await tx.execute(sql`
        DELETE FROM verifications o
        USING verifications c
        WHERE c.id = ${current.id}::uuid
          AND o.value = c.value AND o.identifier LIKE ${RESET_IDENTIFIER_PATTERN}
          AND (o.created_at, o.id) < (c.created_at, c.id)
      `);
    } else {
      // Quota atteint : aucun e-mail ne portera ce jeton, il ne doit pas survivre.
      await tx.execute(sql`DELETE FROM verifications WHERE id = ${current.id}::uuid`);
    }
    return result;
  });
}

/**
 * Efface un jeton qu'aucun e-mail ne portera (envoi désactivé, faute de
 * clé de scellement). Renvoie le nombre de lignes supprimées.
 */
export async function discardPasswordResetToken(db: Db, input: { userId: string; storedIdentifier: string }): Promise<number> {
  const rows = await db.delete(schema.verifications)
    .where(and(
      eq(schema.verifications.identifier, input.storedIdentifier),
      eq(schema.verifications.value, input.userId),
    ))
    .returning({ id: schema.verifications.id });
  return rows.length;
}

export interface PasswordResetCleanup {
  verificationsDeleted: number;
  sessionsDeleted: number;
}

/**
 * Après un changement de mot de passe par lien : purge des jetons du compte
 * (autres liens, défis 2FA, appareils de confiance), des sessions, et
 * adresse tenue pour vérifiée puisque le lien y est parvenu. Les compteurs
 * 2fa-attempts-* (value = nombre d'essais) ne sont pas visés : ils expirent
 * seuls et ne donnent aucun accès. two_factors reste intact.
 */
export async function cleanupAfterPasswordReset(db: Db, userId: string): Promise<PasswordResetCleanup> {
  return db.transaction(async (tx) => {
    const verifications = await tx.delete(schema.verifications)
      .where(eq(schema.verifications.value, userId))
      .returning({ id: schema.verifications.id });
    const sessions = await tx.delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .returning({ id: schema.sessions.id });
    await tx.update(schema.users).set({ emailVerified: true })
      .where(eq(schema.users.id, userId));
    return { verificationsDeleted: verifications.length, sessionsDeleted: sessions.length };
  });
}

/** Organisations dont le compte est membre (rôle d'identité, hors contexte tenant). */
export async function listUserTenantIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ tenantId: schema.memberships.tenantId }).from(schema.memberships)
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.tenantId));
  return rows.map((r) => r.tenantId);
}

/**
 * Trace la réinitialisation dans le journal de chaque organisation du
 * compte : le responsable de chacune doit pouvoir la voir. Une transaction
 * par organisation, comme acceptInvitation. Renvoie le nombre d'entrées.
 */
export async function recordPasswordReset(db: Db, input: {
  userId: string; ip?: string; userAgent?: string;
}): Promise<number> {
  const tenantIds = await listUserTenantIds(db, input.userId);
  for (const tenantId of tenantIds) {
    await withTenant(db, tenantId, (tx) => writeAuditEntry(tx, {
      tenantId, actorUserId: input.userId, action: 'account.password_reset',
      objectType: 'account', objectId: input.userId, ip: input.ip, userAgent: input.userAgent,
    }));
  }
  return tenantIds.length;
}
