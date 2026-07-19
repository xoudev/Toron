/**
 * Règles métier de la gestion documentaire (module 5.6, MVP light).
 * Pures et testées.
 */

export const DOCUMENT_TYPES = [
  'pssi',
  'politique',
  'procedure',
  'charte',
  'pca_pra',
  'fiche_processus',
  'autre',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_VERSION_STATUSES = ['brouillon', 'publie'] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];

/**
 * RM §5.6 : une version PUBLIÉE est immuable ; seule une version en brouillon
 * peut être modifiée (contenu, statut). Reflète la contrainte posée en base
 * (trigger), réutilisable côté client avant l'aller-retour serveur.
 */
export function canEditVersion(status: DocumentVersionStatus): boolean {
  return status === 'brouillon';
}

/**
 * Prochaine version semver par défaut : incrément mineur pour un nouveau
 * brouillon (2.4 → 2.5) ; « 1.0 » si aucune version. N'impose rien — l'auteur
 * peut saisir une majeure. Tolère l'absence de patch.
 */
export function nextSemver(latest: string | null): string {
  if (!latest) return '1.0';
  const parts = latest.trim().replace(/^v/i, '').split('.');
  const major = Number(parts[0]);
  const minor = Number(parts[1] ?? '0');
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return '1.0';
  return `${major}.${minor + 1}`;
}

/** Une date de revue est dépassée si elle est strictement antérieure à aujourd'hui. */
export function reviewOverdue(reviewDue: Date | null, today: Date): boolean {
  if (!reviewDue) return false;
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day(reviewDue) < day(today);
}

// ── Éditeur riche : modèles par type + durcissement HTML ───────────────
// L'éditeur intégré produit du HTML riche (titres, listes, couleurs). On
// fournit un modèle de départ par type et on durcit le HTML au stockage
// (défense en profondeur ; l'allowlist DOM côté client reste la barrière
// principale au rendu).

export interface DocumentTemplate {
  label: string;
  html: string;
}

const AC = '#cb4e0a'; // accent Toron
const H = (t: string): string => `<h1 style="color:${AC}">${t}</h1>`;
const SUB = (t: string): string => `<p style="color:#5b605d"><em>${t}</em></p>`;

export const DOCUMENT_TEMPLATES: Record<DocumentType, DocumentTemplate> = {
  pssi: {
    label: 'PSSI',
    html:
      H('Politique de sécurité du système d’information') +
      SUB('Version 1.0 — à valider par la direction') +
      '<h2>1. Objet et engagement de la direction</h2><p>La présente politique fixe les orientations de sécurité de l’information de l’organisation et l’engagement de la direction à les faire appliquer.</p>' +
      '<h2>2. Périmètre</h2><p>Systèmes, données et sites couverts par le SMSI.</p>' +
      '<h2>3. Principes de sécurité</h2><ul><li>Confidentialité, intégrité, disponibilité et traçabilité.</li><li>Analyse et traitement des risques (EBIOS RM).</li><li>Amélioration continue.</li></ul>' +
      '<h2>4. Rôles et responsabilités</h2><p>RSSI, propriétaires d’actifs, utilisateurs.</p>' +
      '<h2>5. Révision</h2><p>Revue au moins annuelle et à chaque changement majeur.</p>',
  },
  politique: {
    label: 'Politique',
    html:
      H('Politique') +
      SUB('Version 1.0') +
      '<h2>1. Objet</h2><p>Décrire l’intention et les règles de la politique.</p>' +
      '<h2>2. Champ d’application</h2><p>Personnes, activités et périmètres concernés.</p>' +
      '<h2>3. Engagements</h2><ul><li>Engagement 1.</li><li>Engagement 2.</li></ul>' +
      '<h2>4. Responsabilités</h2><p>Qui applique, qui contrôle.</p>' +
      '<h2>5. Révision</h2><p>Fréquence et déclencheurs de mise à jour.</p>',
  },
  procedure: {
    label: 'Procédure',
    html:
      H('Procédure') +
      SUB('Version 1.0') +
      '<h2>1. Objet et domaine d’application</h2><p>But de la procédure et périmètre.</p>' +
      '<h2>2. Acteurs</h2><p>Rôles impliqués.</p>' +
      '<h2>3. Déroulement</h2><ol><li>Étape 1 — …</li><li>Étape 2 — …</li><li>Étape 3 — …</li></ol>' +
      '<h2>4. Enregistrements et preuves</h2><p>Documents produits et conservés.</p>' +
      '<h2>5. Indicateurs</h2><p>Comment mesurer l’efficacité de la procédure.</p>',
  },
  charte: {
    label: 'Charte',
    html:
      H('Charte') +
      SUB('Version 1.0') +
      '<h2>Préambule</h2><p>Contexte et finalité de la charte.</p>' +
      '<h2>Règles</h2><ul><li>Règle 1.</li><li>Règle 2.</li><li>Règle 3.</li></ul>' +
      '<h2>Engagements de l’utilisateur</h2><p>Ce que l’utilisateur accepte en signant.</p>' +
      '<h2>Sanctions</h2><p>Conséquences en cas de non-respect.</p>',
  },
  pca_pra: {
    label: 'PCA / PRA',
    html:
      H('Plan de continuité / reprise d’activité') +
      SUB('Version 1.0') +
      '<h2>1. Contexte et périmètre</h2><p>Activités critiques couvertes.</p>' +
      '<h2>2. Scénarios de sinistre</h2><ul><li>Indisponibilité du SI.</li><li>Perte de site.</li></ul>' +
      '<h2>3. Objectifs</h2><p>RTO (durée max d’interruption) et RPO (perte de données max).</p>' +
      '<h2>4. Procédures de reprise</h2><ol><li>Bascule.</li><li>Restauration.</li><li>Retour à la normale.</li></ol>' +
      '<h2>5. Tests et exercices</h2><p>Fréquence et résultats attendus.</p>',
  },
  fiche_processus: {
    label: 'Fiche processus',
    html:
      H('Fiche de processus') +
      SUB('Version 1.0') +
      '<h2>Finalité</h2><p>Raison d’être du processus.</p>' +
      '<h2>Pilote</h2><p>Responsable du processus.</p>' +
      '<h2>Entrées → Sorties</h2><ul><li>Entrées : …</li><li>Sorties : …</li></ul>' +
      '<h2>Indicateurs</h2><p>Mesures de performance et cibles.</p>' +
      '<h2>Risques et opportunités</h2><p>À relier au registre des risques.</p>',
  },
  autre: {
    label: 'Document',
    html: H('Titre du document') + SUB('Version 1.0') + '<h2>Section 1</h2><p>Rédigez votre contenu ici…</p>',
  },
};

/** Le modèle HTML de départ pour un type de document. */
export function documentTemplate(type: string): string {
  return (DOCUMENT_TEMPLATES[type as DocumentType] ?? DOCUMENT_TEMPLATES.autre).html;
}

/**
 * Durcit un fragment HTML avant stockage (défense en profondeur) : retire les
 * balises exécutables et les vecteurs d'événement. L'allowlist DOM côté client
 * reste la barrière principale au rendu.
 */
export function hardenDocumentHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|noscript|template)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*(?:javascript|data|vbscript):[^"']*\2/gi, '$1=$2#$2');
}
