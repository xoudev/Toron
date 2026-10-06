import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Export complet des données d'une organisation (P5 : anti-verrouillage) ──
// Toutes les tables qui portent un tenant_id sont exportées telles que la
// politique RLS les montre au rôle applicatif : rien de plus, rien de moins.
// Les contenus binaires (PDF scellés, fichiers de preuve stockés en base)
// sont remplacés par leur empreinte et leur taille ; ils se téléchargent
// individuellement depuis les écrans concernés.

export interface TenantExport {
  format: 'toron-export';
  version: 1;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  counts: Record<string, number>;
}

function tenantTables(): { name: string; binaryColumns: string[] }[] {
  const out: { name: string; binaryColumns: string[] }[] = [];
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const columns = getTableColumns(value);
    if (!('tenantId' in columns)) continue;
    const binaryColumns = Object.values(columns)
      .filter((c) => c.getSQLType() === 'bytea')
      .map((c) => c.name);
    out.push({ name: getTableName(value), binaryColumns });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Liste des collections incluses dans l'export, pour l'afficher à l'utilisateur. */
export function exportedTableNames(): string[] {
  return [...tenantTables().map((t) => t.name), 'membres'];
}

export async function exportTenantData(tx: TenantTx, now = new Date()): Promise<TenantExport> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const t of tenantTables()) {
    const projection = t.binaryColumns.length === 0
      ? sql`*`
      : sql.join([
          sql`t.*`,
          ...t.binaryColumns.map((c) => sql`encode(sha256(${sql.identifier(c)}), 'hex') AS ${sql.identifier(`${c}_sha256`)}, octet_length(${sql.identifier(c)}) AS ${sql.identifier(`${c}_bytes`)}`),
        ], sql`, `);
    const rows = (await tx.execute(
      sql`SELECT ${projection} FROM ${sql.identifier(t.name)} t`,
    )) as unknown as Record<string, unknown>[];
    for (const row of rows) for (const c of t.binaryColumns) delete row[c];
    tables[t.name] = rows;
    counts[t.name] = rows.length;
  }
  // Annuaire des membres : résout les identifiants d'utilisateurs présents dans
  // les autres collections. La politique RLS de users ne montre que les
  // membres de l'organisation courante ; aucun secret d'authentification.
  const membres = (await tx.execute(sql`
    SELECT u.id, u.name, u.email, m.role, m.created_at AS membre_depuis
    FROM memberships m JOIN users u ON u.id = m.user_id
    ORDER BY u.name
  `)) as unknown as Record<string, unknown>[];
  tables['membres'] = membres;
  counts['membres'] = membres.length;
  return { format: 'toron-export', version: 1, exportedAt: now.toISOString(), tables, counts };
}
