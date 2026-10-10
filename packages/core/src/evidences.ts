/**
 * Règles métier du coffre de preuves (module 5.7). Pures et testées.
 * RM §5.7 : une preuve expirée SIGNALE (elle ne change pas le statut des
 * exigences couvertes — l'humain décide, l'outil signale).
 */

export const EVIDENCE_TYPES = ['capture', 'export', 'attestation', 'rapport', 'pv'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_RECURRENCES = [
  'ponctuelle',
  'trimestrielle',
  'semestrielle',
  'annuelle',
] as const;
export type EvidenceRecurrence = (typeof EVIDENCE_RECURRENCES)[number];

/** États de fraîcheur, du plus urgent au plus sain (ordre = priorité de tri). */
export const FRESHNESS_STATES = ['expiree', 'bientot', 'fraiche', 'permanente'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

/** Fenêtre « bientôt expirée » : 30 jours avant l'échéance. */
export const EXPIRING_SOON_DAYS = 30;

function toDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 86_400_000;

/**
 * Fraîcheur d'une preuve d'après sa date de validité :
 * - pas d'échéance ⇒ `permanente` ;
 * - échéance passée ⇒ `expiree` ;
 * - échéance dans ≤ 30 jours ⇒ `bientot` ;
 * - sinon ⇒ `fraiche`.
 */
export function freshnessState(validUntil: Date | null, today: Date): FreshnessState {
  if (!validUntil) return 'permanente';
  const diffDays = (toDay(validUntil) - toDay(today)) / DAY_MS;
  if (diffDays < 0) return 'expiree';
  if (diffDays <= EXPIRING_SOON_DAYS) return 'bientot';
  return 'fraiche';
}

/** Rang de tri « expirées d'abord » (0 = expirée … 3 = permanente). */
export function freshnessRank(state: FreshnessState): number {
  return FRESHNESS_STATES.indexOf(state);
}

/** true si l'état doit attirer l'attention (expirée ou bientôt). */
export function freshnessNeedsAttention(state: FreshnessState): boolean {
  return state === 'expiree' || state === 'bientot';
}

const RECURRENCE_MONTHS: Record<EvidenceRecurrence, number | null> = {
  ponctuelle: null,
  trimestrielle: 3,
  semestrielle: 6,
  annuelle: 12,
};

/**
 * Validité proposée pour une preuve collectée à `collectedAt` (AAAA-MM-JJ)
 * selon sa récurrence ; null pour une preuve ponctuelle. Le jour est borné au
 * dernier jour du mois d'arrivée (31/01 + 1 mois → 28 ou 29/02).
 */
export function suggestedValidUntil(collectedAt: string, recurrence: EvidenceRecurrence): string | null {
  const months = RECURRENCE_MONTHS[recurrence];
  if (months === null) return null;
  const [y, m, d] = collectedAt.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d!, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Validité retenue au dépôt : la date saisie, sinon celle que propose la
 * récurrence. Une preuve récurrente sans échéance passerait pour permanente
 * et ne serait jamais signalée à renouveler.
 */
export function effectiveValidUntil(collectedAt: string, recurrence: EvidenceRecurrence, validUntil: string | null): string | null {
  return validUntil ?? suggestedValidUntil(collectedAt, recurrence);
}

/** Taille maximale d'un fichier de preuve (§8). */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Allowlist des extensions de preuve (§8) : PDF, images, CSV et texte,
 * bureautique Word, Excel, PowerPoint, ODT et ODS (dont tous les formats de
 * l'espace Documents), archives ZIP.
 */
export const EVIDENCE_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'csv', 'txt', 'md', 'json',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'zip',
] as const;

/** Valeur de l'attribut `accept` des sélecteurs de fichier de preuve. */
export const EVIDENCE_ACCEPT = EVIDENCE_EXTENSIONS.map((e) => `.${e}`).join(',');

/**
 * Formats admis, tels qu'annoncés sous les champs de dépôt et dans le refus :
 * nommés un à un, une famille (« LibreOffice ») promettrait l'.odp, refusé.
 */
export const EVIDENCE_FORMATS_LABEL = 'PDF, images (PNG, JPG), CSV, texte, Word, Excel, PowerPoint, ODT, ODS, ZIP';

/**
 * Contrôle d'un fichier de preuve avant dépôt : vide, trop volumineux ou d'un
 * format hors allowlist. Appliqué dans le navigateur pour prévenir avant
 * l'envoi, et sur le serveur, qui fait foi. Rend null si le fichier est admis.
 */
export function evidenceFileError(file: { name: string; size: number }): { code: string; message: string } | null {
  if (file.size === 0) {
    return { code: 'FICHIER_VIDE', message: 'Le fichier choisi est vide — choisissez le bon fichier.' };
  }
  if (file.size > EVIDENCE_MAX_BYTES) {
    return { code: 'FICHIER_TROP_GROS', message: 'Fichier trop volumineux — 10 Mo maximum. Compressez-le ou scindez-le.' };
  }
  const dot = file.name.lastIndexOf('.');
  const ext = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase();
  if (!(EVIDENCE_EXTENSIONS as readonly string[]).includes(ext)) {
    const found = ext ? `Format non admis (.${ext})` : 'Fichier sans extension';
    return { code: 'TYPE_REFUSE', message: `${found} — formats acceptés : ${EVIDENCE_FORMATS_LABEL}.` };
  }
  return null;
}
