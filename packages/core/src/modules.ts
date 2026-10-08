// Modules activables par organisation. Le socle (référentiels, plan
// d'action, documents, preuves, paramètres) est toujours présent ; les
// modules ci-dessous s'activent selon le besoin de l'organisation.
// Désactiver un module est un choix d'interface : les données restent en
// base, protégées par les mêmes droits, et réapparaissent à la réactivation.

import type { ScopeKind } from './organisation.ts';

export const OPTIONAL_MODULES = [
  'risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs', 'revue_direction', 'processus', 'non_conformites', 'derogations',
  'sensibilisation', 'continuite',
] as const;
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];

export const MODULE_META: Record<OptionalModule, { label: string; description: string; path: string; requires?: OptionalModule; family: 'risques' | 'management' | 'qualite' }> = {
  risques: { label: 'Registre des risques', description: 'Cotation brute et nette, traitement, acceptation formelle.', path: '/risques', family: 'risques' },
  ebios: { label: 'Ateliers EBIOS RM', description: 'Méthode ANSSI guidée ; les scénarios alimentent le registre des risques.', path: '/ebios', requires: 'risques', family: 'risques' },
  incidents: { label: 'Incidents', description: 'Qualification, chronologie NIS 2 (24 h, 72 h, J+30) et volet RGPD.', path: '/incidents', family: 'risques' },
  actifs: { label: 'Cartographie des actifs', description: 'Inventaire, classification DICP et risques liés.', path: '/actifs', family: 'risques' },
  audits: { label: 'Audits internes', description: 'Programme, constats et conversion en actions correctives.', path: '/audits', family: 'management' },
  fournisseurs: { label: 'Fournisseurs', description: 'Registre des tiers, criticité, données confiées et clauses.', path: '/fournisseurs', family: 'management' },
  revue_direction: { label: 'Revue de direction', description: 'Ordre du jour automatique, décisions et procès-verbal scellé.', path: '/revue-direction', family: 'management' },
  processus: { label: 'Processus', description: 'Cartographie SIPOC, indicateurs et pilotes (ISO 9001).', path: '/processus', family: 'qualite' },
  non_conformites: { label: 'Non-conformités', description: 'Causes, actions correctives et vérification d’efficacité.', path: '/non-conformites', family: 'qualite' },
  derogations: { label: 'Dérogations', description: 'Écarts tolérés à une règle : décision d’un tiers, mesures compensatoires et échéance.', path: '/derogations', family: 'management' },
  sensibilisation: { label: 'Sensibilisation et formation', description: 'Sessions, participation, feuilles d’émargement et formation des dirigeants (NIS 2).', path: '/sensibilisation', family: 'management' },
  continuite: { label: 'Continuité d’activité', description: 'Bilan d’impact, DMIA et PDMA, exercices de reprise et enseignements.', path: '/continuite', family: 'risques' },
};

/** Modules sans objet pour une nature de périmètre, désactivés à la création. */
const OFF_BY_KIND: Record<ScopeKind, OptionalModule[]> = {
  smsi: ['processus', 'non_conformites'],
  qms: ['ebios', 'incidents', 'actifs'],
  mixte: [],
};

export function defaultDisabledModules(kind: ScopeKind): OptionalModule[] {
  return [...OFF_BY_KIND[kind]];
}

/**
 * Normalise une liste de modules désactivés : valeurs connues uniquement,
 * sans doublon, ordre canonique, et désactivation en cascade des modules qui
 * dépendent d'un module désactivé (EBIOS RM sans registre des risques).
 */
export function normalizeDisabledModules(input: readonly string[]): OptionalModule[] {
  const set = new Set(input.filter((m): m is OptionalModule => (OPTIONAL_MODULES as readonly string[]).includes(m)));
  for (const m of OPTIONAL_MODULES) {
    const req = MODULE_META[m].requires;
    if (req && set.has(req)) set.add(m);
  }
  return OPTIONAL_MODULES.filter((m) => set.has(m));
}

export function isModuleEnabled(disabled: readonly string[], module: OptionalModule): boolean {
  return !disabled.includes(module);
}

/** Module optionnel servi par un segment de chemin (« risques », « revue-direction »…), ou null pour le socle. */
export function moduleForSegment(segment: string): OptionalModule | null {
  return OPTIONAL_MODULES.find((m) => MODULE_META[m].path === `/${segment}`) ?? null;
}

/** Module dont relève un type d'élément de « Mon travail » ou de la recherche. */
const KIND_MODULE: Record<string, OptionalModule> = {
  risque: 'risques',
  incident: 'incidents',
  nc: 'non_conformites',
  audit: 'audits',
  fournisseur: 'fournisseurs',
  processus: 'processus',
  actif: 'actifs',
  revue: 'revue_direction',
  derogation: 'derogations',
  formation: 'sensibilisation',
  continuite: 'continuite',
};

/** Un élément d'un module masqué n'apparaît ni dans « Mon travail » ni dans la recherche. */
export function workKindEnabled(kind: string, disabled: readonly string[]): boolean {
  const m = KIND_MODULE[kind];
  return m === undefined || !disabled.includes(m);
}
