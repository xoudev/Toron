/**
 * Règles métier de la gestion documentaire (module 5.6, MVP light).
 * Pures et testées.
 */

export const DOCUMENT_TYPES = [
  'pssi',
  'politique',
  'procedure',
  'charte',
  'pca_pra',
  'fiche_processus',
  'autre',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_VERSION_STATUSES = ['brouillon', 'publie'] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];

/**
 * RM §5.6 : une version PUBLIÉE est immuable ; seule une version en brouillon
 * peut être modifiée (contenu, statut). Reflète la contrainte posée en base
 * (trigger), réutilisable côté client avant l'aller-retour serveur.
 */
export function canEditVersion(status: DocumentVersionStatus): boolean {
  return status === 'brouillon';
}

/**
 * Prochaine version semver par défaut : incrément mineur pour un nouveau
 * brouillon (2.4 → 2.5) ; « 1.0 » si aucune version. N'impose rien — l'auteur
 * peut saisir une majeure. Tolère l'absence de patch.
 */
export function nextSemver(latest: string | null): string {
  if (!latest) return '1.0';
  const parts = latest.trim().replace(/^v/i, '').split('.');
  const major = Number(parts[0]);
  const minor = Number(parts[1] ?? '0');
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return '1.0';
  return `${major}.${minor + 1}`;
}

/** Une date de revue est dépassée si elle est strictement antérieure à aujourd'hui. */
export function reviewOverdue(reviewDue: Date | null, today: Date): boolean {
  if (!reviewDue) return false;
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day(reviewDue) < day(today);
}
