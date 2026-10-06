// Génération CSV pour les exports de registres et du journal d'audit.
// Point-virgule et BOM UTF-8 : ouverture directe dans Excel en français.
// Toute cellule commençant par un caractère de formule est préfixée d'une
// apostrophe pour empêcher l'injection de formules (CSV injection).

export type CsvValue = string | number | boolean | Date | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  let s: string;
  if (value === null || value === undefined) s = '';
  else if (value instanceof Date) s = value.toISOString();
  else if (typeof value === 'boolean') s = value ? 'oui' : 'non';
  else s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(';')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Nom de fichier sûr : lettres, chiffres, tirets uniquement. */
export function csvFileName(parts: readonly string[], date: string): string {
  const safe = parts.map((p) => p.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  return `${[...safe, date].filter(Boolean).join('-')}.csv`;
}
