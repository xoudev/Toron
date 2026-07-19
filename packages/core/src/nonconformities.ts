/**
 * Règles métier des non-conformités & CAPA (module 7.2, pack QMS). Pures et
 * testées. RM §7.2 (subtilité ISO) : la clôture planifie une vérification
 * d'efficacité à J+90 — que les outils génériques ratent.
 */

export const NC_SOURCES = ['interne', 'fournisseur', 'reclamation_client'] as const;
export type NcSource = (typeof NC_SOURCES)[number];

export const NC_GRAVITIES = ['mineure', 'majeure', 'critique'] as const;
export type NcGravity = (typeof NC_GRAVITIES)[number];

export const NC_STATUSES = [
  'ouverte',
  'en_traitement',
  'cloturee_a_verifier',
  'efficace',
  'rouverte',
] as const;
export type NcStatus = (typeof NC_STATUSES)[number];

/** Délai par défaut de la vérification d'efficacité après clôture (jours). */
export const EFFECTIVENESS_DELAY_DAYS = 90;

/** Date de vérification d'efficacité : clôture + 90 jours (RM §7.2). */
export function effectivenessCheckDate(closedAt: Date): Date {
  return new Date(closedAt.getTime() + EFFECTIVENESS_DELAY_DAYS * 86_400_000);
}

/**
 * Une NC est ouverte tant qu'elle n'est ni « efficace » (clôturée et
 * vérifiée) — l'état « clôturée · efficacité à vérifier » reste actif.
 */
export function isNcOpen(status: NcStatus): boolean {
  return status !== 'efficace';
}

/**
 * La vérification d'efficacité est à faire si la NC est « à vérifier » et que
 * la date de contrôle (J+90) est atteinte.
 */
export function effectivenessDue(
  status: NcStatus,
  checkAt: Date | null,
  today: Date,
): boolean {
  if (status !== 'cloturee_a_verifier' || !checkAt) return false;
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day(checkAt) <= day(today);
}
