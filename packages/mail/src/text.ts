// Assainissement des valeurs insérées dans un e-mail : en-têtes (objet,
// noms), corps HTML, et détection des valeurs qui ressemblent à un lien.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** Longueur par défaut d'une valeur d'en-tête, en caractères. */
export const HEADER_TEXT_MAX = 200;

/**
 * Valeur sûre pour un en-tête ou une ligne de texte : les caractères de
 * contrôle (dont CR et LF) et les sauts Unicode deviennent des espaces, les
 * caractères de format (dont les marques bidi U+202E, U+2066) disparaissent,
 * les espaces sont repliés, puis la valeur est tronquée avec « … ».
 */
export function headerText(value: string, max = HEADER_TEXT_MAX): string {
  const clean = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  return `${chars.slice(0, Math.max(max - 1, 0)).join('').trimEnd()}…`;
}

/**
 * Vrai si la valeur contient un schéma d'URL, un « www. », une adresse
 * e-mail ou un nom de domaine (« exemple-piege.fr ») : un client de
 * messagerie en ferait un lien cliquable.
 */
export function looksLikeLink(value: string): boolean {
  const v = headerText(value, Number.MAX_SAFE_INTEGER);
  if (/[a-z][a-z0-9+.-]*:\/\/|\bwww\.|@/i.test(v)) return true;
  return /(?:^|[^\p{L}\p{N}_-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}])/u.test(v);
}

const PARIS_DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** « 10 octobre 2026 à 14 h 32 (heure de Paris) », « 1er » pour le premier du mois. */
export function parisDateTime(date: Date): string {
  const parts = PARIS_DATE_TIME.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const day = part('day') === '1' ? '1er' : part('day');
  return `${day} ${part('month')} ${part('year')} à ${part('hour')}\u202fh\u202f${part('minute')} (heure de Paris)`;
}
