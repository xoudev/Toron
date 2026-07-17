import { sql } from 'drizzle-orm';

import type { Db } from './client.js';

/** Transaction Drizzle liée à un tenant (contexte RLS posé). */
export type TenantTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Point d'accès unique aux données métier (ADR-3).
 *
 * Ouvre une transaction et pose `app.tenant_id` en variable de session
 * locale à la transaction (équivalent SET LOCAL) : les politiques RLS
 * filtrent alors toutes les lectures/écritures sur le tenant donné.
 *
 * Toute requête émise HORS de ce wrapper échoue : les politiques lisent
 * current_setting('app.tenant_id') sans valeur par défaut, Postgres lève
 * donc une erreur — échec bruyant plutôt que résultat vide (S4).
 *
 * La vérification de l'appartenance (session → membership) est faite par
 * la couche d'authentification avant l'appel (M0-3) ; ce wrapper est la
 * dernière ligne de défense, pas la première.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(
      'withTenant : identifiant de tenant invalide — un UUID est attendu. ' +
        'Vérifiez que le contexte tenant provient de la session authentifiée.',
    );
  }
  return db.transaction(async (tx) => {
    // set_config(..., is_local => true) : portée limitée à la transaction,
    // aucun résidu de contexte sur la connexion rendue au pool.
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
