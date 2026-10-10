// En-tête Content-Disposition des téléchargements de fichiers déposés
// (preuves, versions de documents). Le nom d'origine est gardé avec ses
// accents (filename*, RFC 6266 / 5987) ; un nom ASCII sert de repli.

const MAX_NAME_CHARS = 120;

/** Encodage RFC 5987 : encodeURIComponent laisse passer ' ( ) *, interdits ici. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function attachmentDisposition(name: string | null, fallback: string): string {
  // Coupe par caractère, pas par unité UTF-16 : une paire de substitution
  // tronquée ferait échouer l'encodage.
  const cleaned = Array.from((name ?? '').replace(/[\p{Cc}"\\]/gu, '').trim()).slice(0, MAX_NAME_CHARS).join('');
  const fileName = cleaned.length > 0 ? cleaned : fallback;
  const ascii = fileName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\- ]+/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
