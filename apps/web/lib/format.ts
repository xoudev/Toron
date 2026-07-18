// Helpers d'affichage partagés par les écrans de données (client + serveur).
// Purs, sans dépendance serveur.

/**
 * Code de référence lisible et STABLE dérivé de l'UUID (ex. RSK-482). Le
 * modèle ne stocke pas de séquence par tenant en MVP ; ce code déterministe
 * sert d'identifiant humain dans les tables et les tiroirs (maquettes §9).
 */
export function refCode(prefix: string, id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 8);
  const n = Number.parseInt(hex, 16) % 1000;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/** Initiales d'un nom pour l'avatar (2 lettres max). */
export function initials(name: string | null | undefined): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Date AAAA-MM-JJ → JJ/MM/AAAA (tiret insécable non ajouté). */
export function frDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
