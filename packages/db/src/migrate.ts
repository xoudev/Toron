import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Applique les migrations SQL du paquet, dans l'ordre lexicographique,
 * chacune dans sa transaction, suivies dans `schema_migrations`.
 *
 * À exécuter avec un rôle DDL (propriétaire du schéma), jamais avec le
 * rôle applicatif : la séparation des rôles app / migrations est un
 * invariant (S5, ADR-3).
 */
export async function applyMigrations(connectionString: string): Promise<string[]> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const already = await sql`SELECT 1 FROM schema_migrations WHERE name = ${file}`;
      if (already.length > 0) continue;
      const ddl = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(ddl);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      applied.push(file);
    }
    // Vérifié à chaque passage, même sans nouvelle migration (voir 0040).
    const leaks = await sql<{ role_name: string; privilege: string }[]>`
      SELECT role_name, privilege FROM runtime_privilege_leaks()`;
    if (leaks.length > 0) {
      const list = leaks.map((l) => `${l.role_name} (${l.privilege})`).join(', ');
      throw new Error(
        `Droits de création accordés à des rôles runtime : ${list}. ` +
          'Retirez-les avec le propriétaire de la base (REVOKE … ON DATABASE / ON SCHEMA public), puis relancez.',
      );
    }
    return applied;
  } finally {
    await sql.end();
  }
}
