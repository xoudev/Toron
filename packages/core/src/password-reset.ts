/**
 * Mot de passe oublié : durée du lien, politique de mot de passe, forme du
 * lien et du jeton. Le jeton ne voyage que dans le fragment de l'URL, que le
 * navigateur n'envoie jamais au serveur ni dans le Referer.
 */

export const PASSWORD_RESET_TTL_SECONDS = 1800;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/**
 * Validité de l'avis « mot de passe modifié » dans la file : passé ce délai,
 * il n'alerte plus utilement. La file refuse toute échéance au-delà d'un jour.
 */
export const PASSWORD_CHANGED_NOTICE_TTL_SECONDS = 12 * 3600;

/** Jeton Better Auth : generateId(24), alphabet [A-Za-z0-9] (environ 143 bits). */
export const RESET_TOKEN_PATTERN = /^[A-Za-z0-9]{24}$/;

const RESET_IDENTIFIER_PREFIX = 'reset-password:';

/**
 * Identifiant stocké dans `verifications` : empreinte SHA-256 de
 * l'identifiant complet, préfixe compris, puis préfixe remis en tête pour
 * que la purge par préfixe et la règle « seul le plus récent » restent possibles.
 */
export async function resetIdentifierStorage(identifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identifier));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${RESET_IDENTIFIER_PREFIX}${hex}`;
}

/**
 * Origine publique (schéma, hôte, port) sans chemin, requête, fragment ni
 * identifiants. Lève une erreur sinon : c'est une faute de configuration.
 */
export function publicOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('Origine publique invalide : URL attendue, par exemple https://app.toron.eu.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Origine publique invalide : schéma http ou https attendu.');
  }
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== ''
    || origin.includes('?') || origin.includes('#')) {
    throw new Error('Origine publique invalide : ni chemin, ni paramètres, ni identifiants.');
  }
  return url.origin;
}

/** Lien envoyé par e-mail : le jeton est dans le fragment, jamais dans le chemin ni la requête. */
export function passwordResetLink(origin: string, token: string): string {
  if (!RESET_TOKEN_PATTERN.test(token)) throw new Error('Jeton de réinitialisation mal formé.');
  return `${publicOrigin(origin)}/mot-de-passe/nouveau#jeton=${token}`;
}

/** Jeton lu dans `location.hash`, ou null si le fragment n'a pas exactement la forme attendue. */
export function readResetFragment(hash: string): string | null {
  const match = /^#?jeton=([A-Za-z0-9]{24})$/.exec(hash);
  return match ? match[1]! : null;
}

export type PasswordPolicyCode = 'TROP_COURT' | 'TROP_LONG' | 'DIFFERENTS';

/**
 * Contrôle côté navigateur, aligné sur Better Auth qui compte en unités
 * UTF-16 (`String.length`) : un verdict nul ici n'est jamais refusé là-bas.
 */
export function passwordPolicyVerdict(password: string, confirmation: string): PasswordPolicyCode | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'TROP_COURT';
  if (password.length > PASSWORD_MAX_LENGTH) return 'TROP_LONG';
  if (password !== confirmation) return 'DIFFERENTS';
  return null;
}

export const PASSWORD_RESET_REQUEST_FLOOR_MS = 400;
export const PASSWORD_RESET_REQUEST_JITTER_MS = 150;

/**
 * Attente à ajouter avant de répondre à une demande de lien, pour que la
 * durée totale ne dise rien de l'existence du compte. `jitterMs` est un
 * entier tiré uniformément par l'appelant entre 0 et
 * PASSWORD_RESET_REQUEST_JITTER_MS ; une valeur hors bornes y est ramenée.
 */
export function resetRequestPadding(elapsedMs: number, jitterMs: number): number {
  const jitter = Number.isFinite(jitterMs)
    ? Math.min(Math.max(Math.trunc(jitterMs), 0), PASSWORD_RESET_REQUEST_JITTER_MS)
    : 0;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(elapsedMs, 0) : 0;
  return Math.max(0, Math.round(PASSWORD_RESET_REQUEST_FLOOR_MS + jitter - elapsed));
}
