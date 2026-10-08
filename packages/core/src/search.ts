// Recherche transverse : analyse de la saisie et métadonnées des résultats.
// Les identifiants lisibles (RSK-482…) sont dérivés de l'UUID ; la même
// dérivation sert à l'affichage et à la recherche par code.

export const SEARCH_KINDS = [
  'risque', 'action', 'incident', 'nc', 'document', 'preuve', 'exigence', 'controle',
  'audit', 'fournisseur', 'obligation', 'traitement', 'actif', 'processus', 'revue', 'derogation', 'formation', 'continuite',
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_KIND_META: Record<SearchKind, { label: string; prefix: string | null; path: string }> = {
  risque: { label: 'Risque', prefix: 'RSK', path: '/risques' },
  action: { label: 'Action', prefix: 'ACT', path: '/plan-action' },
  incident: { label: 'Incident', prefix: 'INC', path: '/incidents' },
  nc: { label: 'Non-conformité', prefix: 'NC', path: '/non-conformites' },
  document: { label: 'Document', prefix: 'DOC', path: '/documents' },
  preuve: { label: 'Preuve', prefix: 'EVI', path: '/preuves' },
  exigence: { label: 'Exigence', prefix: null, path: '/referentiels' },
  controle: { label: 'Contrôle', prefix: null, path: '/controles' },
  audit: { label: 'Audit', prefix: 'AUD', path: '/audits' },
  fournisseur: { label: 'Fournisseur', prefix: 'FRN', path: '/fournisseurs' },
  obligation: { label: 'Obligation', prefix: 'OBL', path: '/obligations' },
  traitement: { label: 'Traitement', prefix: 'TRT', path: '/traitements' },
  actif: { label: 'Actif', prefix: 'AST', path: '/actifs' },
  processus: { label: 'Processus', prefix: 'PRC', path: '/processus' },
  revue: { label: 'Revue de direction', prefix: 'REV', path: '/revue-direction' },
  derogation: { label: 'Dérogation', prefix: 'DRG', path: '/derogations' },
  formation: { label: 'Session de formation', prefix: null, path: '/sensibilisation' },
  continuite: { label: 'Continuité', prefix: null, path: '/continuite' },
};

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;

export type SearchQuery =
  | { type: 'vide' }
  | { type: 'texte'; text: string }
  | { type: 'code'; kind: SearchKind; number: number; text: string };

/**
 * « ACT-98 », « act 098 » → recherche par code ; sinon recherche textuelle.
 * Saisie bornée et nettoyée des caractères de contrôle.
 */
export function parseSearchQuery(raw: string): SearchQuery {
  let text = '';
  for (const ch of raw) if (ch.charCodeAt(0) >= 0x20) text += ch;
  text = text.trim().replace(/\s+/g, ' ').slice(0, SEARCH_MAX_LENGTH);
  if (text.length < SEARCH_MIN_LENGTH) return { type: 'vide' };
  const m = /^([A-Za-z]{2,3})[\s-]?(\d{1,3})$/.exec(text);
  if (m) {
    const prefix = m[1]!.toUpperCase();
    const kind = SEARCH_KINDS.find((k) => SEARCH_KIND_META[k].prefix === prefix);
    if (kind) return { type: 'code', kind, number: Number(m[2]), text };
  }
  return { type: 'texte', text };
}

/** Numéro lisible dérivé des 6 derniers chiffres hexadécimaux de l'UUID. */
export function refNumber(id: string): number {
  const hex = id.replace(/-/g, '').slice(-6);
  return Number.parseInt(hex, 16) % 1000;
}

export function refCodeFor(kind: SearchKind, id: string): string | null {
  const prefix = SEARCH_KIND_META[kind].prefix;
  return prefix ? `${prefix}-${String(refNumber(id)).padStart(3, '0')}` : null;
}

/** Motif ILIKE « contient », jokers de la saisie neutralisés (échappement \). */
export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Pliage des accents et apostrophes, caractère pour caractère : la même table
 * sert à `translate()` côté SQL, si bien que « securite » trouve « Sécurité »
 * et « l'entrepot » trouve « l’entrepôt ». Les deux chaînes ont même longueur.
 */
export const SEARCH_FOLD_FROM = 'àáâäãåçèéêëìíîïñòóôöõùúûüýÿœæ’‘';
export const SEARCH_FOLD_TO = "aaaaaaceeeeiiiinooooouuuuyyoa''";

export function foldForSearch(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) {
    const i = SEARCH_FOLD_FROM.indexOf(ch);
    out += i >= 0 ? SEARCH_FOLD_TO[i] : ch;
  }
  return out;
}

export const SEARCH_MAX_TERMS = 5;

/**
 * Termes d'une recherche textuelle : pliés, dédoublonnés, cinq au plus.
 * Chaque terme doit figurer dans l'intitulé, dans n'importe quel ordre.
 */
export function searchTerms(text: string): string[] {
  const terms = foldForSearch(text).split(' ').filter((t) => t.length > 0);
  return [...new Set(terms)].slice(0, SEARCH_MAX_TERMS);
}
