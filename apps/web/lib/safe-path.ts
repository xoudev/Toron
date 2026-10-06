/**
 * N'accepte comme destination après connexion qu'un chemin interne absolu :
 * ni URL externe, ni « // », ni schéma. Sinon, retour à la page par défaut.
 */
export function safeInternalPath(candidate: string | null | undefined, fallback = '/organisations'): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback;
  for (const ch of candidate) if (ch.charCodeAt(0) < 0x20) return fallback;
  return candidate.length > 512 ? fallback : candidate;
}
