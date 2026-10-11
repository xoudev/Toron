/**
 * E-mails transactionnels : règles pures de la file d'envoi.
 */

/**
 * Quotas des e-mails de compte. La fonction SQL enqueue_account_email
 * (migration 0041) les applique en dur ; cette constante en est le miroir
 * documentaire, et un test de packages/db échoue si les deux divergent.
 */
export const ACCOUNT_EMAIL_QUOTAS = {
  mot_de_passe_reinitialisation: { perHour: 3, perDay: 5 },
  mot_de_passe_modifie: { perDay: 5 },
  globalPerHour: 200,
} as const;

/** Un envoi qui ne peut plus partir 5 minutes avant l'expiration du lien n'est pas tenté. */
export const MIN_SEND_MARGIN_SECONDS = 300;
export const MAX_SEND_ATTEMPTS = 6;
/** Durée du bail d'une ligne réclamée par le service mail. */
export const LEASE_SECONDS = 120;

/** Délais avant la tentative suivante, après l'échec de la tentative n (n = 1 à 5). */
const RETRY_DELAYS_SECONDS = [30, 120, 600, 1800, 7200] as const;

/**
 * Date de la prochaine tentative après l'échec de la tentative `attempt`
 * (comptée à partir de 1), ou null si l'envoi doit s'arrêter : tentatives
 * épuisées, ou date trop proche de l'expiration pour que la file la reprenne.
 * Un Retry-After du fournisseur allonge le délai, jamais ne le raccourcit.
 */
export function nextAttemptAt(now: Date, attempt: number, expiresAt: Date, retryAfterSeconds?: number): Date | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= MAX_SEND_ATTEMPTS) return null;
  const step = RETRY_DELAYS_SECONDS[Math.min(attempt, RETRY_DELAYS_SECONDS.length) - 1]!;
  const floor = retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds
    : 0;
  const at = now.getTime() + Math.max(step, floor) * 1000;
  // claim_next_email expire toute ligne dont l'échéance tombe dans la marge.
  if (at >= expiresAt.getTime() - MIN_SEND_MARGIN_SECONDS * 1000) return null;
  return new Date(at);
}

export type ProviderErrorCode =
  | 'LIMITE_FOURNISSEUR'
  | 'FOURNISSEUR_INDISPONIBLE'
  | 'RESEAU'
  | 'DELAI'
  | 'CONFIGURATION'
  | 'REFUS_FOURNISSEUR';

/**
 * Suite à donner à une réponse du fournisseur :
 * - reprise : nouvelle tentative plus tard (une tentative est consommée) ;
 * - liberation : la ligne retourne en file sans consommer de tentative, car
 *   le défaut vient de notre configuration et non du message ;
 * - definitif : le fournisseur refuse ce message, inutile de réessayer.
 */
export type ProviderVerdict =
  | { effect: 'envoye' }
  | { effect: 'reprise'; code: 'LIMITE_FOURNISSEUR' | 'FOURNISSEUR_INDISPONIBLE' | 'RESEAU' | 'DELAI' }
  | { effect: 'liberation'; code: 'CONFIGURATION' }
  | { effect: 'definitif'; code: 'REFUS_FOURNISSEUR' };

/**
 * Classe un statut HTTP, une erreur réseau ou un délai dépassé. Un délai
 * dépassé est repris même si le fournisseur a pu accepter l'envoi : un
 * doublon (même lien, même contenu) vaut mieux qu'un e-mail perdu.
 */
export function classifyProviderResponse(response: number | 'reseau' | 'delai'): ProviderVerdict {
  if (response === 'reseau') return { effect: 'reprise', code: 'RESEAU' };
  if (response === 'delai') return { effect: 'reprise', code: 'DELAI' };
  if (response >= 200 && response < 300) return { effect: 'envoye' };
  if (response === 429) return { effect: 'reprise', code: 'LIMITE_FOURNISSEUR' };
  if (response === 408) return { effect: 'reprise', code: 'DELAI' };
  if (response === 401 || response === 403 || response === 404) return { effect: 'liberation', code: 'CONFIGURATION' };
  if (response >= 400 && response < 500) return { effect: 'definitif', code: 'REFUS_FOURNISSEUR' };
  // 5xx, et toute réponse inattendue (1xx, 3xx) : reprise bornée par MAX_SEND_ATTEMPTS.
  return { effect: 'reprise', code: 'FOURNISSEUR_INDISPONIBLE' };
}

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_OPEN_SECONDS = 60;
export const CIRCUIT_MAX_OPEN_SECONDS = 900;
export const CIRCUIT_CONFIGURATION_OPEN_SECONDS = 300;

/**
 * Disjoncteur du service mail, sérialisable tel quel (dates en millisecondes
 * depuis l'époque Unix). `trips` compte les ouvertures successives sans envoi
 * réussi entre elles : il fixe la durée de la prochaine ouverture.
 */
export interface CircuitState {
  phase: 'ferme' | 'ouvert' | 'semi_ouvert';
  consecutiveFailures: number;
  trips: number;
  openUntil: number | null;
}

export const CIRCUIT_CLOSED: CircuitState = { phase: 'ferme', consecutiveFailures: 0, trips: 0, openUntil: null };

function openFor(state: CircuitState, seconds: number, now: Date, trips: number): CircuitState {
  const until = now.getTime() + seconds * 1000;
  return { phase: 'ouvert', consecutiveFailures: 0, trips, openUntil: Math.max(until, state.openUntil ?? 0) };
}

/**
 * Avant un envoi : le disjoncteur laisse-t-il passer ? Une fois le délai
 * d'ouverture écoulé, il passe en semi-ouverture et n'autorise qu'un essai,
 * dont le résultat (circuitNext) le referme ou le rouvre.
 */
export function circuitGate(state: CircuitState, now: Date): { allowed: boolean; state: CircuitState } {
  if (state.phase === 'ferme') return { allowed: true, state };
  if (state.phase === 'semi_ouvert') return { allowed: false, state };
  if (state.openUntil !== null && now.getTime() < state.openUntil) return { allowed: false, state };
  return { allowed: true, state: { ...state, phase: 'semi_ouvert', openUntil: null } };
}

/** État du disjoncteur après le résultat d'un envoi. */
export function circuitNext(state: CircuitState, verdict: ProviderVerdict, now: Date): CircuitState {
  switch (verdict.effect) {
    // Un refus du fournisseur prouve qu'il répond : il ne compte pas comme une panne.
    case 'envoye':
    case 'definitif':
      return CIRCUIT_CLOSED;
    case 'liberation':
      return openFor(state, CIRCUIT_CONFIGURATION_OPEN_SECONDS, now, state.trips);
    case 'reprise': {
      if (state.phase === 'ouvert') return state;
      const failures = state.consecutiveFailures + 1;
      if (state.phase === 'ferme' && failures < CIRCUIT_FAILURE_THRESHOLD) {
        return { ...state, consecutiveFailures: failures };
      }
      const seconds = Math.min(CIRCUIT_OPEN_SECONDS * 2 ** state.trips, CIRCUIT_MAX_OPEN_SECONDS);
      return openFor(state, seconds, now, state.trips + 1);
    }
  }
}

/** Domaines de premier niveau réservés (RFC 2606, RFC 6761) : aucun envoi réel n'y aboutit. */
const RESERVED_TLDS = ['example', 'test', 'invalid', 'localhost'] as const;
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

function recipientDomain(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return null;
  return address.slice(at + 1).toLowerCase().replace(/\.$/, '');
}

/**
 * Adresse dans un domaine réservé, sous-domaines compris. Une adresse sans
 * domaine est traitée comme réservée : elle n'a de toute façon aucun destinataire.
 */
export function isReservedRecipient(address: string): boolean {
  const domain = recipientDomain(address.trim());
  if (domain === null) return true;
  const within = (d: string) => domain === d || domain.endsWith(`.${d}`);
  return RESERVED_TLDS.some(within) || RESERVED_DOMAINS.some(within);
}

/**
 * Liste blanche du staging. Une entrée est une adresse complète
 * (« rssi@meridiane.fr ») ou un domaine (« meridiane.fr » ou « @meridiane.fr »),
 * comparé exactement : un domaine n'autorise pas ses sous-domaines.
 */
export function recipientAllowed(address: string, allowlist: readonly string[]): boolean {
  const normalized = address.trim().toLowerCase();
  const domain = recipientDomain(normalized);
  if (domain === null) return false;
  return allowlist.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (entry === '' || entry === '@') return false;
    if (entry.startsWith('@')) return entry.slice(1) === domain;
    return entry.includes('@') ? entry === normalized : entry === domain;
  });
}
