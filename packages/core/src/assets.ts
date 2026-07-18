/**
 * Règles métier des actifs (module 6.3, MVP minimal). Pures et testées.
 * Import CSV comme porte d'entrée (P produit) ; cotation DICP.
 */

export const ASSET_CATEGORIES = ['materiel', 'logiciel', 'donnees', 'flux'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** Alias FR acceptés en import CSV pour la colonne catégorie. */
const CATEGORY_ALIASES: Record<string, AssetCategory> = {
  materiel: 'materiel',
  matériel: 'materiel',
  hardware: 'materiel',
  logiciel: 'logiciel',
  software: 'logiciel',
  application: 'logiciel',
  donnees: 'donnees',
  données: 'donnees',
  data: 'donnees',
  flux: 'flux',
  flow: 'flux',
};

export interface Dicp {
  d: number;
  i: number;
  c: number;
  p: number;
}

/** Un axe DICP est valide s'il est entier de 1 à 4. */
export function isDicpAxisValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 4;
}

/** Sensibilité globale d'un actif : le maximum de ses axes DICP (1-4). */
export function assetSensitivity(dicp: Dicp): number {
  return Math.max(dicp.d, dicp.i, dicp.c, dicp.p);
}

export interface ParsedAssetRow {
  name: string;
  category: AssetCategory;
  description: string | null;
  dicp: Dicp;
}

export interface CsvParseResult {
  rows: ParsedAssetRow[];
  errors: string[];
}

function splitCsvLine(line: string): string[] {
  // CSV simple : séparateur virgule ou point-virgule, guillemets optionnels.
  const sep = line.includes(';') && !line.includes(',') ? ';' : ',';
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Analyse un CSV d'actifs. En-tête attendu (insensible à la casse/accents) :
 * `name, category, description, d, i, c, p`. `description` et les axes DICP
 * sont optionnels (défaut DICP = 1). Renvoie les lignes valides ET les erreurs
 * ligne par ligne — l'import n'échoue jamais en silence.
 */
export function parseAssetsCsv(text: string): CsvParseResult {
  const rows: ParsedAssetRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows, errors: ['Fichier vide.'] };

  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const col = (names: string[]): number => header.findIndex((h) => names.includes(h));
  const iName = col(['name', 'nom', 'actif']);
  const iCat = col(['category', 'categorie', 'catégorie', 'type']);
  const iDesc = col(['description', 'desc']);
  const iD = col(['d', 'disponibilite', 'disponibilité']);
  const iI = col(['i', 'integrite', 'intégrité']);
  const iC = col(['c', 'confidentialite', 'confidentialité']);
  const iP = col(['p', 'preuve', 'traçabilite', 'tracabilite']);
  if (iName < 0 || iCat < 0) {
    return { rows, errors: ['En-tête invalide : les colonnes « name » et « category » sont requises.'] };
  }

  const axis = (cells: string[], idx: number): number => {
    if (idx < 0) return 1;
    const raw = cells[idx];
    if (!raw) return 1;
    const n = Number(raw);
    return isDicpAxisValid(n) ? n : NaN;
  };

  for (let ln = 1; ln < lines.length; ln += 1) {
    const cells = splitCsvLine(lines[ln]!);
    const name = cells[iName]?.trim() ?? '';
    if (name.length === 0) {
      errors.push(`Ligne ${ln + 1} : nom manquant, ignorée.`);
      continue;
    }
    const catRaw = (cells[iCat] ?? '').toLowerCase().trim();
    const category = CATEGORY_ALIASES[catRaw];
    if (!category) {
      errors.push(`Ligne ${ln + 1} (« ${name} ») : catégorie « ${catRaw} » inconnue, ignorée.`);
      continue;
    }
    const dicp = { d: axis(cells, iD), i: axis(cells, iI), c: axis(cells, iC), p: axis(cells, iP) };
    if ([dicp.d, dicp.i, dicp.c, dicp.p].some((n) => Number.isNaN(n))) {
      errors.push(`Ligne ${ln + 1} (« ${name} ») : cotation DICP hors 1-4, ignorée.`);
      continue;
    }
    rows.push({
      name: name.slice(0, 200),
      category,
      description: iDesc >= 0 && cells[iDesc] ? cells[iDesc]!.slice(0, 2000) : null,
      dicp,
    });
  }
  return { rows, errors };
}
