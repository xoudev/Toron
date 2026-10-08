import { SEARCH_FOLD_FROM, SEARCH_FOLD_TO, likeContains, searchTerms, type SearchKind, type SearchQuery } from '@toron/core';
import { sql, type SQL } from 'drizzle-orm';

import type { TenantTx } from '../tenant.ts';

// ── Recherche transverse (palette Ctrl+K) ───────────────────────────────
// Lecture seule dans le contexte RLS : chaque table ne renvoie que les lignes
// de l'organisation courante (et les exigences des référentiels intégrés).
// Les noms de tables et de colonnes sont des constantes de ce fichier ; la
// saisie n'entre dans la requête que comme paramètre lié.

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Complément affiché (référentiel d'une exigence, code de clause…). */
  detail: string | null;
  /** Objet parent utile à la navigation (référentiel d'une exigence). */
  parentId: string | null;
}

interface Source {
  kind: SearchKind;
  table: string;
  title: string;
}

// Ordre d'affichage des groupes de résultats.
const SOURCES: Source[] = [
  { kind: 'risque', table: 'risks', title: 'title' },
  { kind: 'action', table: 'actions', title: 'title' },
  { kind: 'incident', table: 'incidents', title: 'title' },
  { kind: 'nc', table: 'nonconformities', title: 'title' },
  { kind: 'document', table: 'documents', title: 'title' },
  { kind: 'preuve', table: 'evidences', title: 'title' },
  { kind: 'controle', table: 'controls', title: 'title' },
  { kind: 'audit', table: 'audits', title: 'title' },
  { kind: 'fournisseur', table: 'suppliers', title: 'name' },
  { kind: 'obligation', table: 'obligations', title: 'title' },
  { kind: 'traitement', table: 'processing_activities', title: 'name' },
  { kind: 'actif', table: 'assets', title: 'name' },
  { kind: 'processus', table: 'processes', title: 'name' },
  { kind: 'revue', table: 'management_reviews', title: 'title' },
  { kind: 'derogation', table: 'policy_exceptions', title: 'title' },
  { kind: 'formation', table: 'training_sessions', title: 'title' },
  { kind: 'continuite', table: 'continuity_activities', title: 'name' },
  { kind: 'continuite', table: 'continuity_exercises', title: 'title' },
];

const PER_KIND = 6;

/** Chaque terme (déjà plié par le cœur) doit figurer dans la colonne pliée. */
function matchesAll(column: SQL, terms: string[]): SQL {
  const folded = sql`translate(lower(${column}), ${SEARCH_FOLD_FROM}, ${SEARCH_FOLD_TO})`;
  return sql.join(terms.map((t) => sql`${folded} LIKE ${likeContains(t)} ESCAPE '\\'`), sql` AND `);
}

/** Numéro lisible (RSK-482) recalculé en SQL, identique à refNumber() du cœur. */
const REF_NUMBER = (alias: string) =>
  sql.raw(`((('x' || right(replace(${alias}.id::text, '-', ''), 6))::bit(24)::int) % 1000)`);

export async function searchTenant(tx: TenantTx, query: SearchQuery): Promise<SearchHit[]> {
  if (query.type === 'vide') return [];
  const parts: SQL[] = [];
  const terms = query.type === 'texte' ? searchTerms(query.text) : [];
  if (query.type === 'texte' && terms.length === 0) return [];

  for (const s of SOURCES) {
    let where: SQL;
    if (query.type === 'code') {
      if (query.kind !== s.kind) continue;
      where = sql`${REF_NUMBER('t')} = ${query.number}`;
    } else {
      where = matchesAll(sql`t.${sql.raw(s.title)}`, terms);
    }
    parts.push(sql`(SELECT ${s.kind}::text AS kind, t.id, t.${sql.raw(s.title)} AS title,
      NULL::text AS detail, NULL::uuid AS parent_id
      FROM ${sql.raw(s.table)} t WHERE ${where}
      ORDER BY t.${sql.raw(s.title)} LIMIT ${PER_KIND})`);
  }

  if (query.type === 'texte') {
    const p = likeContains(query.text);
    const label = sql`r.ref_id || ' ' || r.title_internal`;
    // Exigences : identifiant de clause ou intitulé, dans les référentiels
    // visibles par l'organisation (intégrés et internes).
    parts.push(sql`(SELECT 'exigence'::text AS kind, r.id, r.ref_id || ' — ' || r.title_internal AS title,
      f.name AS detail, r.framework_id AS parent_id
      FROM requirements r JOIN frameworks f ON f.id = r.framework_id
      WHERE ${matchesAll(label, terms)}
      ORDER BY (r.ref_id ILIKE ${p} ESCAPE '\\') DESC, f.name, r.sort_order LIMIT ${PER_KIND})`);
  }

  if (parts.length === 0) return [];
  const rows = (await tx.execute(sql.join(parts, sql` UNION ALL `))) as unknown as {
    kind: SearchKind; id: string; title: string; detail: string | null; parent_id: string | null;
  }[];
  return rows.map((r) => ({ kind: r.kind, id: r.id, title: r.title, detail: r.detail, parentId: r.parent_id }));
}
