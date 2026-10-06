// Sections de l'écran Paramètres (navigation secondaire, écran 14).
// Module sans directive client : partagé par la page serveur et l'interface.

export const SECTIONS = [
  { key: 'organisation', label: 'Organisation' },
  { key: 'perimetres', label: 'Périmètres' },
  { key: 'membres', label: 'Utilisateurs & rôles' },
  { key: 'securite', label: 'Sécurité' },
  { key: 'journal', label: 'Journal d’audit' },
  { key: 'donnees', label: 'Données' },
] as const;

export type Section = (typeof SECTIONS)[number]['key'];

export function parseSection(raw: string | string[] | undefined): Section {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SECTIONS.find((s) => s.key === v)?.key ?? 'organisation';
}
