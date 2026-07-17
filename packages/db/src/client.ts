import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.ts';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

/**
 * Crée un client de base de données. La chaîne de connexion est fournie
 * par l'appelant (validée à la frontière, S2/S3) — ce paquet ne lit
 * jamais l'environnement lui-même.
 */
export function createDb(connectionString: string): DbHandle {
  const sql = postgres(connectionString, {
    // Les transactions withTenant() reposent sur SET LOCAL : jamais de
    // prepared statements partagés entre sessions en mode pool externe.
    prepare: false,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    close: () => sql.end(),
  };
}
