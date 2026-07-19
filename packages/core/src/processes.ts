// ── Processus (module 7.1, pack QMS — ISO 9001 §4.4) ───────────────────
// Types partagés du bloc processus (SIPOC, indicateurs, exigences couvertes,
// interactions) et règles pures : dérivation de la santé depuis les
// indicateurs, comptage de la mutualisation (contrôles 27001 adossés au QMS).
// Aucun texte intégral de norme : identifiants de clause uniquement.

import type { Tone } from './reviews.ts';

export type ProcessFamily = 'management' | 'realisation' | 'support';
export type ProcessWorkflow = 'brouillon' | 'relecture' | 'approuve' | 'publie';
export type ProcessHealth = 'sain' | 'a_surveiller' | 'en_alerte';

export const PROCESS_FAMILIES: readonly ProcessFamily[] = ['management', 'realisation', 'support'];
export const PROCESS_FAMILY_LABEL: Record<ProcessFamily, string> = {
  management: 'Management',
  realisation: 'Réalisation',
  support: 'Support',
};
export const WORKFLOW_STATUSES: readonly ProcessWorkflow[] = ['brouillon', 'relecture', 'approuve', 'publie'];
export const WORKFLOW_LABEL: Record<ProcessWorkflow, string> = {
  brouillon: 'Brouillon',
  relecture: 'Relecture',
  approuve: 'Approuvé',
  publie: 'Publié',
};
export const PROCESS_HEALTH_LABEL: Record<ProcessHealth, string> = {
  sain: 'Sain',
  a_surveiller: 'À surveiller',
  en_alerte: 'En alerte',
};

/** Colonnes de la cartouche SIPOC, dans l'ordre normalisé. */
export const SIPOC_COLUMNS = [
  { key: 'suppliers', label: 'Fournisseurs' },
  { key: 'inputs', label: 'Entrées' },
  { key: 'activities', label: 'Activités' },
  { key: 'outputs', label: 'Sorties' },
  { key: 'clients', label: 'Clients' },
] as const;

export interface Sipoc {
  suppliers: string[];
  inputs: string[];
  activities: string[];
  outputs: string[];
  clients: string[];
}

export interface ProcessKpi {
  label: string;
  actual: string;
  target: string;
  tone: Tone;
}

export interface ProcessRequirement {
  /** Référentiel (ex. « 9001 », « 27001 »). */
  framework: string;
  /** Identifiant de clause/contrôle (ex. « §8.5 », « A.8.16 »). */
  code: string;
  /** true si un contrôle 27001 s'y adosse — le fil orange de mutualisation. */
  mutualized: boolean;
}

export interface ProcessInteraction {
  dir: '←' | '→' | '↔';
  name: string;
}

/**
 * Dérive la santé d'un processus de ses indicateurs et de ses NC ouvertes :
 * une NC ouverte ou un indicateur critique le met en alerte ; un indicateur
 * sous sa cible le met à surveiller ; sinon il est sain.
 */
export function deriveProcessHealth(kpis: ProcessKpi[], openNcCount = 0): ProcessHealth {
  if (openNcCount > 0 || kpis.some((k) => k.tone === 'danger')) return 'en_alerte';
  if (kpis.some((k) => k.tone === 'warn')) return 'a_surveiller';
  return 'sain';
}

/** Nombre d'exigences couvertes qui mutualisent un contrôle 27001. */
export function processMutualizationCount(reqs: ProcessRequirement[]): number {
  return reqs.filter((r) => r.mutualized).length;
}
