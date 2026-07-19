/**
 * Moteur d'import (module 5.13) — la porte d'entrée n°1 du produit.
 * Pur et testé : détection des colonnes, validation LIGNE À LIGNE avec cause
 * exacte et correction proposée. RM §5.13 : jamais d'échec silencieux (S4).
 * Le parsing de fichier (CSV/XLSX) est fait par l'appelant ; ici on ne
 * travaille que sur des lignes déjà tabulées.
 */

export const IMPORT_TARGETS = ['risk', 'action', 'asset'] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse un fichier tabulaire délimité (CSV, TSV, point-virgule — exports Excel).
 * Détecte le séparateur sur la première ligne. La 1ʳᵉ ligne est l'en-tête.
 */
export function parseDelimited(text: string): ParsedTable {
  // Retire un éventuel BOM (U+FEFF) en tête, sans caractère littéral.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const head = lines[0]!;
  const sep = head.includes('\t') ? '\t' : head.includes(';') && !head.includes(',') ? ';' : ',';
  const headers = splitLine(head, sep);
  const rows = lines.slice(1).map((l) => splitLine(l, sep));
  return { headers, rows };
}

type FieldKind = 'text' | 'int14' | 'int16' | 'date' | 'enum';

export interface FieldSpec {
  field: string;
  label: string;
  aliases: string[];
  required: boolean;
  kind: FieldKind;
  enumValues?: readonly string[];
  /** Alias de valeurs FR → valeur canonique (pour les enums). */
  valueAliases?: Record<string, string>;
}

export interface TargetSpec {
  target: ImportTarget;
  label: string;
  fields: FieldSpec[];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/g, '');
}

const TREATMENT_ALIASES: Record<string, string> = {
  reduire: 'reduire', reduce: 'reduire', transferer: 'transferer', transfer: 'transferer',
  accepter: 'accepter', accept: 'accepter', eviter: 'eviter', avoid: 'eviter',
};
const CATEGORY_ALIASES: Record<string, string> = {
  materiel: 'materiel', hardware: 'materiel', logiciel: 'logiciel', software: 'logiciel', application: 'logiciel',
  donnees: 'donnees', data: 'donnees', flux: 'flux', flow: 'flux',
};
const PRIORITY_ALIASES: Record<string, string> = {
  p1: 'p1', haute: 'p1', high: 'p1', p2: 'p2', moyenne: 'p2', medium: 'p2', p3: 'p3', basse: 'p3', low: 'p3',
};

export const TARGET_SPECS: Record<ImportTarget, TargetSpec> = {
  risk: {
    target: 'risk',
    label: 'Risques',
    fields: [
      { field: 'title', label: 'Intitulé', aliases: ['intitule', 'titre', 'risque', 'nom', 'name'], required: true, kind: 'text' },
      { field: 'businessValue', label: 'Valeur métier', aliases: ['valeurmetier', 'valeur', 'actif', 'businessvalue'], required: false, kind: 'text' },
      { field: 'scenario', label: 'Scénario', aliases: ['scenario', 'description'], required: false, kind: 'text' },
      { field: 'grossG', label: 'Gravité brute', aliases: ['gravitebrute', 'gbrut', 'gbrute', 'g'], required: true, kind: 'int16' },
      { field: 'grossV', label: 'Vraisemblance brute', aliases: ['vraisemblancebrute', 'vbrut', 'vbrute', 'v'], required: true, kind: 'int16' },
      { field: 'netG', label: 'Gravité nette', aliases: ['gravitenette', 'gnet', 'gnette'], required: true, kind: 'int16' },
      { field: 'netV', label: 'Vraisemblance nette', aliases: ['vraisemblancenette', 'vnet', 'vnette'], required: true, kind: 'int16' },
      { field: 'treatment', label: 'Traitement', aliases: ['traitement', 'treatment', 'option'], required: false, kind: 'enum', enumValues: ['reduire', 'transferer', 'accepter', 'eviter'], valueAliases: TREATMENT_ALIASES },
    ],
  },
  action: {
    target: 'action',
    label: 'Actions',
    fields: [
      { field: 'title', label: 'Intitulé', aliases: ['intitule', 'titre', 'action', 'nom', 'name'], required: true, kind: 'text' },
      { field: 'description', label: 'Description', aliases: ['description', 'desc'], required: false, kind: 'text' },
      { field: 'priority', label: 'Priorité', aliases: ['priorite', 'priority', 'prio'], required: false, kind: 'enum', enumValues: ['p1', 'p2', 'p3'], valueAliases: PRIORITY_ALIASES },
      { field: 'dueDate', label: 'Échéance', aliases: ['echeance', 'duedate', 'date', 'deadline'], required: false, kind: 'date' },
    ],
  },
  asset: {
    target: 'asset',
    label: 'Actifs',
    fields: [
      { field: 'name', label: 'Intitulé', aliases: ['nom', 'name', 'actif', 'intitule'], required: true, kind: 'text' },
      { field: 'category', label: 'Catégorie', aliases: ['categorie', 'category', 'type'], required: true, kind: 'enum', enumValues: ['materiel', 'logiciel', 'donnees', 'flux'], valueAliases: CATEGORY_ALIASES },
      { field: 'description', label: 'Description', aliases: ['description', 'desc'], required: false, kind: 'text' },
      { field: 'dicpD', label: 'DICP · Disponibilité', aliases: ['disponibilite', 'd'], required: false, kind: 'int14' },
      { field: 'dicpI', label: 'DICP · Intégrité', aliases: ['integrite', 'i'], required: false, kind: 'int14' },
      { field: 'dicpC', label: 'DICP · Confidentialité', aliases: ['confidentialite', 'c'], required: false, kind: 'int14' },
      { field: 'dicpP', label: 'DICP · Preuve', aliases: ['preuve', 'tracabilite', 'p'], required: false, kind: 'int14' },
    ],
  },
};

/** Exemple de valeur par champ pour le modèle CSV téléchargeable. */
const TEMPLATE_EXAMPLES: Record<ImportTarget, Record<string, string>> = {
  risk: {
    title: 'Rançongiciel sur le SI de production',
    businessValue: 'Continuité des livraisons',
    scenario: 'Chiffrement des serveurs après hameçonnage',
    grossG: '4', grossV: '3', netG: '3', netV: '2', treatment: 'reduire',
  },
  action: {
    title: 'Déployer la MFA sur les accès distants',
    description: 'VPN + messagerie, priorité P1',
    priority: 'p1', dueDate: '2026-09-30',
  },
  asset: {
    name: 'Serveur de fichiers principal',
    category: 'materiel', description: 'Baie du siège',
    dicpD: '3', dicpI: '3', dicpC: '4', dicpP: '2',
  },
};

/**
 * Modèle CSV (point-virgule, en-tête + une ligne d'exemple) pour une cible.
 * Fournit les en-têtes exacts que la détection reconnaît à coup sûr.
 */
export function csvTemplate(target: ImportTarget): string {
  const spec = TARGET_SPECS[target];
  const headers = spec.fields.map((f) => f.label);
  const example = spec.fields.map((f) => TEMPLATE_EXAMPLES[target][f.field] ?? '');
  const esc = (v: string): string => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${headers.map(esc).join(';')}\n${example.map(esc).join(';')}\n`;
}

export interface ColumnMapping {
  field: string;
  label: string;
  /** Index de colonne dans le fichier, ou null si non détecté. */
  columnIndex: number | null;
  confidence: number; // 0..1
}

/** Détecte la correspondance colonne du fichier → champ Toron, avec confiance. */
export function detectMapping(headers: readonly string[], target: ImportTarget): ColumnMapping[] {
  const normHeaders = headers.map(norm);
  return TARGET_SPECS[target].fields.map((f) => {
    let best: { idx: number; conf: number } | null = null;
    normHeaders.forEach((h, idx) => {
      if (!h) return;
      let conf = 0;
      if (f.aliases.includes(h)) conf = 1;
      // Sous-chaîne seulement si les deux font ≥ 3 caractères : évite qu'un
      // alias d'un caractère (d/i/c/p, g/v) capte une colonne au hasard.
      else if (h.length >= 3 && f.aliases.some((a) => a.length >= 3 && (h.includes(a) || a.includes(h)))) conf = 0.7;
      if (conf > 0 && (!best || conf > best.conf)) best = { idx, conf };
    });
    return {
      field: f.field,
      label: f.label,
      columnIndex: best ? (best as { idx: number }).idx : null,
      confidence: best ? (best as { conf: number }).conf : 0,
    };
  });
}

export interface RejectedRow {
  line: number;
  cause: string;
  suggestion: string;
  raw: string[];
}

export interface ValidationResult {
  rows: Record<string, unknown>[];
  rejected: RejectedRow[];
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

interface FieldError {
  cause: string;
  suggestion: string;
}

function validateField(spec: FieldSpec, raw: string): { value: unknown } | { error: FieldError } {
  const v = raw.trim();
  if (v === '') {
    if (spec.required) return { error: { cause: `« ${spec.label} » manquant`, suggestion: `renseignez la colonne « ${spec.label} »` } };
    return { value: null };
  }
  switch (spec.kind) {
    case 'text':
      return { value: v.slice(0, 2000) };
    case 'int14':
    case 'int16': {
      const max = spec.kind === 'int14' ? 4 : 6;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > max) {
        return { error: { cause: `« ${spec.label} » = ‹ ${v} › invalide`, suggestion: `entier entre 1 et ${max}` } };
      }
      return { value: n };
    }
    case 'date': {
      if (DATE_ISO.test(v)) {
        const [y, m, d] = v.split('-').map(Number);
        if (isRealDate(y!, m!, d!)) return { value: v };
      }
      const fr = DATE_FR.exec(v);
      if (fr) {
        const d = Number(fr[1]), m = Number(fr[2]), y = Number(fr[3]);
        if (isRealDate(y, m, d)) return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
      }
      return { error: { cause: `échéance ‹ ${v} › invalide`, suggestion: 'corriger la date (JJ/MM/AAAA)' } };
    }
    case 'enum': {
      const key = norm(v);
      const canon = spec.valueAliases?.[key] ?? (spec.enumValues?.includes(v as never) ? v : undefined);
      if (!canon) {
        return { error: { cause: `« ${spec.label} » = ‹ ${v} › non reconnu`, suggestion: `valeurs admises : ${spec.enumValues?.join(', ')}` } };
      }
      return { value: canon };
    }
  }
}

/**
 * Valide les lignes de données (hors en-tête) selon le mapping. Chaque ligne
 * est SOIT un objet valide, SOIT une ligne rejetée avec sa cause et sa
 * correction — jamais un comptage muet (RM §5.13).
 */
export function validateRows(
  dataRows: readonly string[][],
  target: ImportTarget,
  mapping: readonly ColumnMapping[],
  headerOffset = 1,
): ValidationResult {
  const spec = TARGET_SPECS[target];
  const byField = new Map(mapping.map((m) => [m.field, m.columnIndex]));
  const rows: Record<string, unknown>[] = [];
  const rejected: RejectedRow[] = [];

  dataRows.forEach((cells, i) => {
    const line = i + headerOffset + 1;
    if (cells.every((c) => (c ?? '').trim() === '')) return; // ligne vide ignorée silencieusement
    const obj: Record<string, unknown> = {};
    let firstError: FieldError | null = null;
    for (const f of spec.fields) {
      const idx = byField.get(f.field);
      const raw = idx === null || idx === undefined ? '' : cells[idx] ?? '';
      const res = validateField(f, raw);
      if ('error' in res) {
        firstError = res.error;
        break;
      }
      obj[f.field] = res.value;
    }
    if (firstError) rejected.push({ line, cause: firstError.cause, suggestion: firstError.suggestion, raw: cells });
    else rows.push(obj);
  });

  return { rows, rejected };
}
