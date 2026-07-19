// Catalogue de référentiels intégrés « légers » — entrées disponibles à
// l'activation, avec leurs exigences de tête (identifiants de clause +
// reformulations maison uniquement ; jamais le texte intégral des normes).
// L'organisation active ce dont elle a besoin et masque le reste.

export interface CatalogRequirement {
  ref: string;
  title: string;
}

export interface CatalogFramework {
  code: string;
  version: string;
  name: string;
  requirements: CatalogRequirement[];
}

export const FRAMEWORK_CATALOG: CatalogFramework[] = [
  {
    code: 'iso9001',
    version: '2015',
    name: 'ISO 9001:2015 — Management de la qualité',
    requirements: [
      { ref: '4', title: 'Contexte de l’organisme' },
      { ref: '5', title: 'Leadership et engagement de la direction' },
      { ref: '6', title: 'Planification — risques et opportunités, objectifs qualité' },
      { ref: '7', title: 'Support — ressources, compétences, information documentée' },
      { ref: '8', title: 'Réalisation des activités opérationnelles' },
      { ref: '9', title: 'Évaluation des performances — surveillance, audit, revue' },
      { ref: '10', title: 'Amélioration — non-conformités et actions correctives' },
    ],
  },
  {
    code: 'rgpd',
    version: '2016',
    name: 'RGPD — Protection des données personnelles',
    requirements: [
      { ref: 'Art.5', title: 'Principes relatifs au traitement des données' },
      { ref: 'Art.6', title: 'Licéité du traitement (bases légales)' },
      { ref: 'Art.13-14', title: 'Information des personnes concernées' },
      { ref: 'Art.15-22', title: 'Droits des personnes (accès, rectification, effacement…)' },
      { ref: 'Art.30', title: 'Registre des activités de traitement' },
      { ref: 'Art.32', title: 'Sécurité du traitement' },
      { ref: 'Art.33-34', title: 'Notification des violations de données' },
      { ref: 'Art.35', title: 'Analyse d’impact relative à la protection des données' },
    ],
  },
  {
    code: 'iso27701',
    version: '2019',
    name: 'ISO/IEC 27701:2019 — Extension vie privée (PIMS)',
    requirements: [
      { ref: '5', title: 'Exigences spécifiques au système de management de la vie privée' },
      { ref: '6', title: 'Guidance SMSI orientée protection de la vie privée' },
      { ref: '7', title: 'Guidance pour les responsables de traitement' },
      { ref: '8', title: 'Guidance pour les sous-traitants' },
    ],
  },
  {
    code: 'iso22301',
    version: '2019',
    name: 'ISO 22301:2019 — Continuité d’activité',
    requirements: [
      { ref: '4', title: 'Contexte et périmètre du système de continuité' },
      { ref: '6', title: 'Objectifs de continuité et planification' },
      { ref: '8.2', title: 'Bilan d’impact sur l’activité et appréciation des risques' },
      { ref: '8.4', title: 'Plans et procédures de continuité d’activité' },
      { ref: '8.5', title: 'Exercices et tests des dispositifs' },
    ],
  },
  {
    code: 'dora',
    version: '2022',
    name: 'DORA — Résilience opérationnelle numérique',
    requirements: [
      { ref: 'Ch.II', title: 'Gestion du risque lié aux TIC' },
      { ref: 'Ch.III', title: 'Gestion et notification des incidents liés aux TIC' },
      { ref: 'Ch.IV', title: 'Tests de résilience opérationnelle numérique' },
      { ref: 'Ch.V', title: 'Gestion du risque lié aux prestataires tiers de services TIC' },
    ],
  },
  {
    code: 'secnumcloud',
    version: '3.2',
    name: 'SecNumCloud — Qualification ANSSI des prestataires cloud',
    requirements: [
      { ref: '5', title: 'Politique de sécurité de l’information' },
      { ref: '9', title: 'Contrôle d’accès' },
      { ref: '12', title: 'Sécurité de l’exploitation' },
      { ref: '17', title: 'Continuité d’activité' },
      { ref: '18', title: 'Localisation et souveraineté des données' },
    ],
  },
];
