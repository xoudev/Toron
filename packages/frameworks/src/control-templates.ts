import { recyf } from './recyf.ts';

// Contrôles types Toron : un point de départ pour une organisation qui n'a
// encore aucun contrôle. Chaque contrôle est décrit avec des mots maison
// (jamais le texte des normes) et rattaché, une fois pour toutes, aux
// exigences qu'il couvre dans chaque référentiel intégré : « Prouvez une
// fois. Couvrez tout. » L'organisation choisit les domaines qu'elle reprend,
// puis adapte chaque contrôle à sa réalité.

export const CONTROL_TEMPLATE_DOMAINS = [
  { key: 'gouvernance', label: 'Gouvernance et pilotage' },
  { key: 'risques', label: 'Gestion des risques' },
  { key: 'personnes', label: 'Ressources humaines' },
  { key: 'actifs', label: 'Actifs et information' },
  { key: 'acces', label: 'Identités et accès' },
  { key: 'administration', label: 'Administration des systèmes' },
  { key: 'postes', label: 'Postes et protection' },
  { key: 'exploitation', label: 'Exploitation' },
  { key: 'reseau', label: 'Réseaux' },
  { key: 'developpement', label: 'Développement' },
  { key: 'fournisseurs', label: 'Fournisseurs' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'continuite', label: 'Continuité et crise' },
  { key: 'physique', label: 'Sécurité physique' },
  { key: 'conformite', label: 'Conformité et amélioration' },
] as const;

export type ControlTemplateDomain = (typeof CONTROL_TEMPLATE_DOMAINS)[number]['key'];
export type ControlTemplateFrequency = 'mensuelle' | 'trimestrielle' | 'semestrielle' | 'annuelle';

/** Référentiels visés par les rattachements, avec la version intégrée à Toron. */
export const CONTROL_TEMPLATE_FRAMEWORKS = {
  iso27001: '2022',
  recyf: 'v2.5',
  rgpd: '2016',
  iso22301: '2019',
  dora: '2022',
  secnumcloud: '3.2',
  iso9001: '2015',
  iso27701: '2019',
} as const;
export type ControlTemplateFramework = keyof typeof CONTROL_TEMPLATE_FRAMEWORKS;

interface TemplateDef {
  key: string;
  domain: ControlTemplateDomain;
  title: string;
  description: string;
  evidence: string;
  frequency: ControlTemplateFrequency;
  /** Références par référentiel ; pour ReCyF, numéro du moyen sans le suffixe EI/EE. */
  map: Partial<Record<ControlTemplateFramework, string[]>>;
}

const DEFS: TemplateDef[] = [
  // ── Gouvernance et pilotage ──────────────────────────────────────────
  {
    key: 'gouvernance.contexte', domain: 'gouvernance', frequency: 'annuelle',
    title: 'Contexte et parties intéressées du système de management',
    description: 'Les enjeux internes et externes, les attentes des parties intéressées et le fonctionnement du système de management sont décrits et revus chaque année.',
    evidence: 'Analyse de contexte datée et liste des parties intéressées.',
    map: { iso27001: ['4.1', '4.2', '4.4'], iso22301: ['4'], iso9001: ['4'] },
  },
  {
    key: 'gouvernance.pssi', domain: 'gouvernance', frequency: 'annuelle',
    title: 'Politique de sécurité approuvée par la direction',
    description: 'Une politique de sécurité des systèmes d’information fixe les orientations, les rôles et les engagements ; elle est approuvée par le dirigeant, revue chaque année et déclinée en politiques thématiques (chiffrement, accès, sauvegarde…).',
    evidence: 'Politique signée par le dirigeant, avec sa date de dernière revue.',
    map: { iso27001: ['5.2', 'A.5.1'], recyf: ['2.B.1', '2.B.2', '2.B.3', '2.B.4', '2.B.5'], secnumcloud: ['5'] },
  },
  {
    key: 'gouvernance.organisation', domain: 'gouvernance', frequency: 'annuelle',
    title: 'Organisation et responsabilités de la sécurité',
    description: 'Le dirigeant porte la sécurité numérique ; un responsable est désigné, les rôles sont répartis (RACI) et un comité suit les décisions.',
    evidence: 'Lettre de mission, RACI et comptes rendus du comité de sécurité.',
    map: { iso27001: ['5.1', '5.3', 'A.5.2', 'A.5.4'], recyf: ['2.A.1', '2.A.2', '2.A.3'] },
  },
  {
    key: 'gouvernance.separation', domain: 'gouvernance', frequency: 'annuelle',
    title: 'Séparation des tâches sensibles',
    description: 'Les tâches incompatibles (demander et valider, administrer et contrôler) sont confiées à des personnes différentes ou compensées par un contrôle a posteriori.',
    evidence: 'Matrice des tâches incompatibles et exceptions justifiées.',
    map: { iso27001: ['A.5.3'] },
  },
  {
    key: 'gouvernance.objectifs', domain: 'gouvernance', frequency: 'semestrielle',
    title: 'Objectifs et indicateurs de sécurité',
    description: 'Des objectifs mesurables sont fixés, suivis par des indicateurs et revus en comité ; les écarts déclenchent des actions.',
    evidence: 'Tableau de bord des indicateurs et objectifs de l’année.',
    map: { iso27001: ['6.2', '9.1'] },
  },
  {
    key: 'gouvernance.ressources', domain: 'gouvernance', frequency: 'annuelle',
    title: 'Ressources et communication du système de management',
    description: 'Les moyens humains et financiers nécessaires sont alloués, et les communications internes et externes sur la sécurité sont planifiées.',
    evidence: 'Budget sécurité et plan de communication.',
    map: { iso27001: ['7.1', '7.4'] },
  },
  {
    key: 'gouvernance.documentation', domain: 'gouvernance', frequency: 'annuelle',
    title: 'Maîtrise des documents et procédures d’exploitation',
    description: 'Politiques, procédures et modes opératoires sont rédigés, approuvés, versionnés et accessibles à ceux qui en ont besoin.',
    evidence: 'Liste des documents en vigueur avec leur version et leur date de revue.',
    map: { iso27001: ['7.5', 'A.5.37'], iso9001: ['7'] },
  },
  {
    key: 'gouvernance.changements', domain: 'gouvernance', frequency: 'trimestrielle',
    title: 'Planification et maîtrise des changements',
    description: 'Les changements sur les systèmes et le système de management sont demandés, évalués, approuvés et tracés avant leur mise en œuvre.',
    evidence: 'Registre des changements avec les validations.',
    map: { iso27001: ['6.3', '8.1', 'A.8.32'] },
  },
  {
    key: 'gouvernance.projets', domain: 'gouvernance', frequency: 'annuelle',
    title: 'Sécurité intégrée aux projets',
    description: 'Chaque projet passe par une analyse de sécurité à son lancement et par une validation avant sa mise en service.',
    evidence: 'Fiches sécurité des projets de l’année.',
    map: { iso27001: ['A.5.8'] },
  },
  {
    key: 'gouvernance.veille', domain: 'gouvernance', frequency: 'trimestrielle',
    title: 'Veille sur les menaces et contacts avec les autorités',
    description: 'L’organisation suit les alertes et la menace (CERT-FR, ANSSI, groupes sectoriels) et tient à jour ses contacts avec les autorités compétentes.',
    evidence: 'Abonnements de veille et annuaire des autorités à jour.',
    map: { iso27001: ['A.5.5', 'A.5.6', 'A.5.7'] },
  },
  {
    key: 'gouvernance.revue_direction', domain: 'gouvernance', frequency: 'annuelle',
    title: 'Revue de direction',
    description: 'La direction examine au moins une fois par an les résultats du système de management et décide des améliorations et des moyens.',
    evidence: 'Procès-verbal de la dernière revue de direction.',
    map: { iso27001: ['9.3', '10.1'], iso9001: ['9'] },
  },
  {
    key: 'gouvernance.conformite', domain: 'gouvernance', frequency: 'trimestrielle',
    title: 'Analyse de conformité et plan de remédiation',
    description: 'La conformité aux référentiels et aux politiques internes est évaluée ; les écarts sont suivis dans un plan d’action daté, avec un responsable, et les mesures alternatives sont justifiées.',
    evidence: 'Dernière évaluation de conformité et plan d’action associé.',
    map: { iso27001: ['A.5.36'], recyf: ['2.C.1', '2.C.2', '2.C.3'] },
  },

  // ── Gestion des risques ──────────────────────────────────────────────
  {
    key: 'risques.appreciation', domain: 'risques', frequency: 'annuelle',
    title: 'Appréciation et traitement des risques',
    description: 'Une méthode documentée identifie, évalue et traite les risques de chaque système ; les risques résiduels sont acceptés par la direction et l’analyse est revue au moins tous les trois ans et après tout incident majeur.',
    evidence: 'Registre des risques, plan de traitement et acceptations signées.',
    map: { iso27001: ['6.1.1', '6.1.2', '6.1.3', '8.2', '8.3'], recyf: ['16.1', '16.2', '16.3', '16.4'], dora: ['Ch.II'], iso9001: ['6'] },
  },

  // ── Ressources humaines ──────────────────────────────────────────────
  {
    key: 'personnes.embauche', domain: 'personnes', frequency: 'annuelle',
    title: 'Vérifications préalables à l’embauche',
    description: 'Les vérifications proportionnées au poste (diplômes, références) sont faites avant l’arrivée, dans le respect du droit du travail.',
    evidence: 'Procédure de recrutement et contrôles réalisés sur les postes sensibles.',
    map: { iso27001: ['A.6.1'] },
  },
  {
    key: 'personnes.contrats', domain: 'personnes', frequency: 'annuelle',
    title: 'Clauses de sécurité et de confidentialité',
    description: 'Contrats de travail et accords de confidentialité engagent les salariés et intervenants pendant et après leur mission.',
    evidence: 'Modèles de contrat et d’accord de confidentialité en vigueur.',
    map: { iso27001: ['A.6.2', 'A.6.6'], recyf: ['4.3'] },
  },
  {
    key: 'personnes.charte', domain: 'personnes', frequency: 'annuelle',
    title: 'Charte d’usage des systèmes d’information',
    description: 'Une charte opposable fixe les règles d’usage des outils et des données, avec les sanctions prévues en cas de manquement.',
    evidence: 'Charte signée ou annexée au règlement intérieur.',
    map: { iso27001: ['A.5.10', 'A.6.4'], recyf: ['4.1'] },
  },
  {
    key: 'personnes.sensibilisation', domain: 'personnes', frequency: 'annuelle',
    title: 'Sensibilisation et formation à la sécurité',
    description: 'Tous les utilisateurs sont sensibilisés à l’arrivée puis régulièrement ; les fonctions exposées et les dirigeants reçoivent une formation spécifique.',
    evidence: 'Programme annuel et feuilles d’émargement.',
    map: { iso27001: ['7.2', '7.3', 'A.6.3'], recyf: ['4.2', '4.5'] },
  },
  {
    key: 'personnes.mouvements', domain: 'personnes', frequency: 'trimestrielle',
    title: 'Arrivées, mobilités et départs',
    description: 'À chaque mouvement, les accès sont attribués, ajustés ou retirés le jour même, et le matériel est restitué au départ.',
    evidence: 'Fiches d’arrivée et de départ signées, avec la date de retrait des accès.',
    map: { iso27001: ['A.5.11', 'A.6.5'], recyf: ['4.4'] },
  },
  {
    key: 'personnes.teletravail', domain: 'personnes', frequency: 'annuelle',
    title: 'Travail à distance encadré',
    description: 'Le travail hors des locaux suit des règles écrites : matériel fourni, connexion protégée, confidentialité de l’environnement.',
    evidence: 'Politique de télétravail et accords individuels.',
    map: { iso27001: ['A.6.7', 'A.7.9'] },
  },

  // ── Actifs et information ────────────────────────────────────────────
  {
    key: 'actifs.recensement', domain: 'actifs', frequency: 'annuelle',
    title: 'Recensement des activités, services et systèmes',
    description: 'Les activités et services, leur responsable et les systèmes qui les portent sont recensés ; les exclusions sont justifiées et l’ensemble est validé chaque année.',
    evidence: 'Recensement validé, avec sa date et les exclusions motivées.',
    map: { iso27001: ['4.3'], recyf: ['1.1', '1.2', '1.3'] },
  },
  {
    key: 'actifs.inventaire', domain: 'actifs', frequency: 'trimestrielle',
    title: 'Inventaire et cartographie des actifs',
    description: 'Matériels, logiciels, données et interconnexions sont inventoriés avec un responsable, dans une cartographie assez précise pour exploiter et réagir.',
    evidence: 'Inventaire et cartographie à jour, avec la date de dernière mise à jour.',
    map: { iso27001: ['A.5.9'], recyf: ['5.A.1'] },
  },
  {
    key: 'actifs.classification', domain: 'actifs', frequency: 'annuelle',
    title: 'Classification et marquage de l’information',
    description: 'Chaque information reçoit un niveau de sensibilité qui détermine son marquage et les règles de manipulation.',
    evidence: 'Politique de classification et exemples de marquage.',
    map: { iso27001: ['A.5.12', 'A.5.13'] },
  },
  {
    key: 'actifs.transferts', domain: 'actifs', frequency: 'annuelle',
    title: 'Transferts d’information encadrés',
    description: 'Les échanges d’information avec l’extérieur suivent des règles (outils autorisés, chiffrement, accords d’échange).',
    evidence: 'Règles d’échange et outils de transfert autorisés.',
    map: { iso27001: ['A.5.14'] },
  },
  {
    key: 'actifs.supports', domain: 'actifs', frequency: 'semestrielle',
    title: 'Supports amovibles, effacement et mise au rebut',
    description: 'Seuls les supports nécessaires sont autorisés ; les données sont effacées de façon sûre avant réemploi ou destruction.',
    evidence: 'Liste des supports autorisés et certificats d’effacement ou de destruction.',
    map: { iso27001: ['A.7.10', 'A.7.14', 'A.8.10'], recyf: ['9.5'] },
  },
  {
    key: 'actifs.fuites', domain: 'actifs', frequency: 'annuelle',
    title: 'Prévention des fuites et masquage des données',
    description: 'Les données sensibles sont masquées hors production et les canaux de fuite (messagerie, partage, impression) sont surveillés.',
    evidence: 'Règles de masquage et rapports de l’outil de prévention des fuites.',
    map: { iso27001: ['A.8.11', 'A.8.12'], rgpd: ['Art.32'] },
  },

  // ── Identités et accès ───────────────────────────────────────────────
  {
    key: 'acces.politique', domain: 'acces', frequency: 'annuelle',
    title: 'Politique de contrôle d’accès et moindre privilège',
    description: 'Les accès ne sont accordés qu’aux personnes et processus authentifiés, au strict besoin de leurs missions, selon une politique écrite.',
    evidence: 'Politique de contrôle d’accès et matrices de droits par application.',
    map: { iso27001: ['A.5.15', 'A.8.3'], recyf: ['10.C.1', '10.C.2', '10.C.3'], rgpd: ['Art.32'], secnumcloud: ['9'] },
  },
  {
    key: 'acces.comptes', domain: 'acces', frequency: 'trimestrielle',
    title: 'Comptes individuels et cycle de vie des identités',
    description: 'Chaque utilisateur et chaque processus dispose de son propre compte ; les comptes partagés sont limités et tracés, les comptes inutiles désactivés dans les délais prévus.',
    evidence: 'Extraction des comptes actifs et liste justifiée des comptes partagés.',
    map: { iso27001: ['A.5.16'], recyf: ['10.A.1', '10.A.2', '10.A.3', '10.A.4', '10.A.5'] },
  },
  {
    key: 'acces.revue', domain: 'acces', frequency: 'semestrielle',
    title: 'Revue périodique des comptes et des droits',
    description: 'Les comptes et les droits sont revus par leurs responsables au moins une fois par an ; les anomalies sont corrigées et tracées.',
    evidence: 'Comptes rendus de revue signés et corrections effectuées.',
    map: { iso27001: ['A.5.18'], recyf: ['10.A.6', '10.C.4'] },
  },
  {
    key: 'acces.authentification', domain: 'acces', frequency: 'annuelle',
    title: 'Authentification et gestion des secrets',
    description: 'Les accès reposent sur des secrets robustes, changés dès la mise en service et conservés dans un coffre-fort ; les exceptions sont compensées et tracées.',
    evidence: 'Politique de mots de passe et configuration de l’annuaire.',
    map: { iso27001: ['A.5.17', 'A.8.5'], recyf: ['10.B.1', '10.B.2', '10.B.3', '10.B.4', '10.B.5', '10.B.6', '10.B.7'] },
  },
  {
    key: 'acces.distants', domain: 'acces', frequency: 'semestrielle',
    title: 'Accès distants chiffrés et à double authentification',
    description: 'Les accès à distance des salariés et prestataires passent par un canal chiffré et une authentification multifacteur ; les exceptions sont compensées.',
    evidence: 'Configuration du VPN ou de la passerelle et taux d’enrôlement à la double authentification.',
    map: { iso27001: ['A.8.5', 'A.8.20'], recyf: ['8.1', '8.2', '8.3', '8.4'] },
  },

  // ── Administration des systèmes ──────────────────────────────────────
  {
    key: 'administration.comptes', domain: 'administration', frequency: 'trimestrielle',
    title: 'Comptes d’administration dédiés et maîtrisés',
    description: 'L’administration se fait uniquement depuis des comptes dédiés, réservés aux administrateurs, recensés et revus à chaque modification ; les utilitaires à privilèges sont restreints.',
    evidence: 'Liste des comptes d’administration et de leurs titulaires.',
    map: { iso27001: ['A.8.2', 'A.8.18'], recyf: ['11.A.1', '11.A.2', '11.A.3', '11.A.4', '11.A.5', '11.A.6', '11.A.7'] },
  },
  {
    key: 'administration.annuaires', domain: 'administration', frequency: 'annuelle',
    title: 'Protection des annuaires et des cœurs de confiance',
    description: 'Annuaires et ressources de confiance sont corrigés sans délai, administrés depuis des comptes et postes dédiés, et leur configuration est auditée chaque année.',
    evidence: 'Dernier audit de l’annuaire et liste des cœurs de confiance.',
    map: { iso27001: ['A.8.2'], recyf: ['11.B.1', '11.B.2', '11.B.3', '11.B.4', '11.B.5', '11.B.6', '11.B.7'] },
  },
  {
    key: 'administration.ressources_dediees', domain: 'administration', frequency: 'annuelle',
    title: 'Administration depuis des ressources dédiées',
    description: 'Les administrateurs travaillent depuis des postes et un réseau d’administration dédiés, avec des flux chiffrés et authentifiés.',
    evidence: 'Schéma du réseau d’administration et liste des postes dédiés.',
    map: { iso27001: ['A.8.22'], recyf: ['19.1', '19.2', '19.3', '19.4', '19.5', '19.6', '19.7', '19.8', '19.9', '19.10', '19.11', '19.12'] },
  },

  // ── Postes et protection ─────────────────────────────────────────────
  {
    key: 'postes.terminaux', domain: 'postes', frequency: 'trimestrielle',
    title: 'Terminaux gérés et autorisés',
    description: 'Seuls les matériels gérés par l’organisation se connectent à ses systèmes ; les autres sont bloqués par des mesures techniques ou organisationnelles.',
    evidence: 'Inventaire des terminaux gérés et règles de contrôle des connexions.',
    map: { iso27001: ['A.8.1'], recyf: ['9.1', '9.2', '9.3', '9.4'] },
  },
  {
    key: 'postes.chiffrement', domain: 'postes', frequency: 'semestrielle',
    title: 'Chiffrement des postes et mobiles',
    description: 'Les disques des postes et des mobiles sont chiffrés en permanence, avec une authentification au démarrage.',
    evidence: 'Rapport de conformité du chiffrement sur le parc.',
    map: { iso27001: ['A.8.1', 'A.8.24'], recyf: ['8.5'], rgpd: ['Art.32'] },
  },
  {
    key: 'postes.malveillants', domain: 'postes', frequency: 'mensuelle',
    title: 'Protection contre les codes malveillants',
    description: 'Postes, serveurs et mobiles sont protégés (antivirus ou EDR à jour) et les fichiers reçus de l’extérieur sont analysés.',
    evidence: 'Console de l’antivirus ou de l’EDR : couverture et mises à jour.',
    map: { iso27001: ['A.8.7'], recyf: ['5.B.2', '9.6', '9.7'] },
  },
  {
    key: 'postes.filtrage_web', domain: 'postes', frequency: 'trimestrielle',
    title: 'Filtrage web',
    description: 'L’accès aux sites malveillants ou non autorisés est bloqué par un filtrage tenu à jour.',
    evidence: 'Politique de filtrage et rapports du filtre.',
    map: { iso27001: ['A.8.23'] },
  },
  {
    key: 'postes.bureau_net', domain: 'postes', frequency: 'annuelle',
    title: 'Bureau et écran nets',
    description: 'Les documents sensibles sont rangés et les sessions verrouillées dès que le poste est laissé sans surveillance.',
    evidence: 'Règle de verrouillage automatique et contrôles ponctuels.',
    map: { iso27001: ['A.7.7'] },
  },

  // ── Exploitation ─────────────────────────────────────────────────────
  {
    key: 'exploitation.vulnerabilites', domain: 'exploitation', frequency: 'mensuelle',
    title: 'Veille et correction des vulnérabilités',
    description: 'Une procédure de maintien en condition de sécurité organise la veille, puis l’application rapide des correctifs, d’abord sur les ressources exposées ; à défaut, des mesures d’atténuation sont prises.',
    evidence: 'Tableau de suivi des correctifs et délais d’application.',
    map: { iso27001: ['A.8.8'], recyf: ['5.B.1', '5.B.3', '5.B.4', '5.B.5', '5.B.6'], dora: ['Ch.II'], secnumcloud: ['12'] },
  },
  {
    key: 'exploitation.obsolescence', domain: 'exploitation', frequency: 'trimestrielle',
    title: 'Versions supportées et logiciels de source officielle',
    description: 'Les logiciels restent dans des versions supportées et ne sont téléchargés qu’aux sources officielles ; toute version non supportée maintenue est isolée.',
    evidence: 'Liste des logiciels hors support et mesures d’isolement.',
    map: { iso27001: ['A.8.8', 'A.8.19'], recyf: ['5.B.7', '5.B.8', '5.B.9'] },
  },
  {
    key: 'exploitation.configuration', domain: 'exploitation', frequency: 'semestrielle',
    title: 'Configuration sécurisée et durcissement',
    description: 'Les ressources sont configurées selon des guides de durcissement, sans logiciel inutile, et leur configuration est revue chaque année.',
    evidence: 'Référentiels de configuration et résultats des scans de conformité.',
    map: { iso27001: ['A.8.9', 'A.8.19'], recyf: ['18.1', '18.2', '18.3', '18.4'] },
  },
  {
    key: 'exploitation.sauvegardes', domain: 'exploitation', frequency: 'mensuelle',
    title: 'Sauvegardes protégées et testées',
    description: 'Les sauvegardes sont dimensionnées selon les besoins de reprise, protégées (copie hors ligne contre les rançongiciels) et restaurées avec succès au moins une fois par an.',
    evidence: 'Rapports de sauvegarde et procès-verbal du dernier test de restauration.',
    map: { iso27001: ['A.8.13'], recyf: ['13.1', '13.2', '13.3', '13.5'], rgpd: ['Art.32'], secnumcloud: ['12'] },
  },
  {
    key: 'exploitation.journalisation', domain: 'exploitation', frequency: 'mensuelle',
    title: 'Journalisation et supervision de sécurité',
    description: 'Les événements utiles à la détection sont collectés, horodatés, conservés au moins trois mois à l’abri d’une altération, et analysés par une supervision dimensionnée.',
    evidence: 'Politique de journalisation et rapports de la supervision.',
    map: { iso27001: ['A.8.15', 'A.8.16', 'A.8.17'], recyf: ['12.6', '12.7', '20.1', '20.2', '20.3', '20.4', '20.5', '20.6'], secnumcloud: ['12'] },
  },
  {
    key: 'exploitation.capacite', domain: 'exploitation', frequency: 'annuelle',
    title: 'Capacité et redondance des systèmes',
    description: 'La capacité des systèmes est suivie et les ressources critiques sont redondées pour tenir les objectifs de disponibilité.',
    evidence: 'Suivi de capacité et architecture de redondance.',
    map: { iso27001: ['A.8.6', 'A.8.14'] },
  },
  {
    key: 'exploitation.cryptographie', domain: 'exploitation', frequency: 'annuelle',
    title: 'Politique de cryptographie et gestion des clés',
    description: 'Les usages du chiffrement, les algorithmes admis et la gestion des clés suivent une politique alignée sur les recommandations de l’ANSSI.',
    evidence: 'Politique de cryptographie et inventaire des certificats.',
    map: { iso27001: ['A.8.24'], rgpd: ['Art.32'] },
  },
  {
    key: 'exploitation.cloud', domain: 'exploitation', frequency: 'annuelle',
    title: 'Usage maîtrisé des services cloud',
    description: 'Les services cloud sont choisis, configurés et quittés selon des règles écrites, avec une attention particulière à la localisation des données.',
    evidence: 'Registre des services cloud et localisation des données.',
    map: { iso27001: ['A.5.23'], secnumcloud: ['18'] },
  },

  // ── Réseaux ──────────────────────────────────────────────────────────
  {
    key: 'reseau.cloisonnement', domain: 'reseau', frequency: 'annuelle',
    title: 'Cloisonnement des systèmes et des réseaux',
    description: 'Les systèmes sont cloisonnés entre eux et vis-à-vis des systèmes tiers ; seules les interconnexions nécessaires sont ouvertes.',
    evidence: 'Schéma de cloisonnement et liste des interconnexions autorisées.',
    map: { iso27001: ['A.8.22'], recyf: ['7.A.1', '7.A.2', '7.A.3', '7.A.4', '7.A.7', '7.A.8'] },
  },
  {
    key: 'reseau.filtrage', domain: 'reseau', frequency: 'semestrielle',
    title: 'Filtrage des flux et passerelles',
    description: 'Les flux autorisés sont documentés, filtrés par des pare-feux dédiés et des passerelles entrantes et sortantes, et les règles sont revues chaque année.',
    evidence: 'Matrice des flux et dernière revue des règles de pare-feu.',
    map: { iso27001: ['A.8.20', 'A.8.21'], recyf: ['7.A.5', '7.A.6', '7.B.1', '7.B.2', '7.B.3', '7.B.4', '7.B.5'] },
  },

  // ── Développement ────────────────────────────────────────────────────
  {
    key: 'developpement.cycle', domain: 'developpement', frequency: 'annuelle',
    title: 'Développement sécurisé',
    description: 'Exigences de sécurité, architecture, codage, revue et tests de sécurité jalonnent le cycle de développement ; l’accès au code source est restreint.',
    evidence: 'Politique de développement et derniers rapports de tests de sécurité.',
    map: { iso27001: ['A.8.4', 'A.8.25', 'A.8.26', 'A.8.27', 'A.8.28', 'A.8.29'] },
  },
  {
    key: 'developpement.environnements', domain: 'developpement', frequency: 'annuelle',
    title: 'Environnements séparés et données de test',
    description: 'Développement, test et production sont séparés ; les données de production utilisées en test sont anonymisées ou autorisées.',
    evidence: 'Schéma des environnements et règles d’usage des données de test.',
    map: { iso27001: ['A.8.31', 'A.8.33'] },
  },
  {
    key: 'developpement.externalise', domain: 'developpement', frequency: 'annuelle',
    title: 'Développement externalisé encadré',
    description: 'Les prestataires de développement suivent les exigences de sécurité de l’organisation, contrôlées à la livraison.',
    evidence: 'Clauses contractuelles et procès-verbaux de recette.',
    map: { iso27001: ['A.8.30'] },
  },

  // ── Fournisseurs ─────────────────────────────────────────────────────
  {
    key: 'fournisseurs.cartographie', domain: 'fournisseurs', frequency: 'annuelle',
    title: 'Cartographie de l’écosystème et des prestataires',
    description: 'Prestataires, fournisseurs et interconnexions sont recensés avec un point de contact à jour et un niveau de criticité.',
    evidence: 'Registre des fournisseurs avec criticité et contacts.',
    map: { iso27001: ['A.5.19'], recyf: ['3.A.1', '3.A.2'], dora: ['Ch.V'] },
  },
  {
    key: 'fournisseurs.contrats', domain: 'fournisseurs', frequency: 'annuelle',
    title: 'Exigences de sécurité dans les contrats',
    description: 'Les contrats engagent les fournisseurs sur la sécurité, la notification des incidents, l’audit et la réversibilité, y compris pour leurs sous-traitants.',
    evidence: 'Clauses types et contrats des fournisseurs critiques.',
    map: { iso27001: ['A.5.20', 'A.5.21'], recyf: ['3.B.1'], dora: ['Ch.V'] },
  },
  {
    key: 'fournisseurs.suivi', domain: 'fournisseurs', frequency: 'annuelle',
    title: 'Évaluation et suivi des fournisseurs',
    description: 'Les fournisseurs sont évalués selon leur criticité (questionnaire, attestations, audit) et les écarts donnent lieu à des actions correctives.',
    evidence: 'Évaluations datées et attestations en cours de validité.',
    map: { iso27001: ['A.5.22'], recyf: ['3.B.2'], dora: ['Ch.V'] },
  },

  // ── Incidents ────────────────────────────────────────────────────────
  {
    key: 'incidents.procedure', domain: 'incidents', frequency: 'annuelle',
    title: 'Procédure de gestion des incidents',
    description: 'Une procédure organise la détection, la qualification, la réponse et la limitation des conséquences des incidents de sécurité.',
    evidence: 'Procédure à jour et registre des incidents.',
    map: { iso27001: ['A.5.24', 'A.5.25', 'A.5.26'], recyf: ['12.1', '12.3', '12.4'], dora: ['Ch.III'] },
  },
  {
    key: 'incidents.signalement', domain: 'incidents', frequency: 'trimestrielle',
    title: 'Signalement des événements de sécurité',
    description: 'Salariés, clients et prestataires disposent d’un canal simple pour signaler un événement, connu de tous.',
    evidence: 'Canal de signalement et signalements reçus.',
    map: { iso27001: ['A.6.8'], recyf: ['12.2'] },
  },
  {
    key: 'incidents.notification', domain: 'incidents', frequency: 'annuelle',
    title: 'Notification réglementaire des incidents et violations',
    description: 'Les incidents significatifs sont notifiés dans les délais (NIS 2 : 24 h, 72 h, un mois ; RGPD : 72 h) aux autorités et, si besoin, aux personnes concernées.',
    evidence: 'Procédure de notification et notifications transmises.',
    map: { iso27001: ['A.5.26'], rgpd: ['Art.33-34'], dora: ['Ch.III'] },
  },
  {
    key: 'incidents.retex', domain: 'incidents', frequency: 'semestrielle',
    title: 'Retour d’expérience et conservation des preuves',
    description: 'Chaque incident significatif donne lieu à une analyse des causes et à des actions ; les relevés techniques sont conservés comme preuves.',
    evidence: 'Comptes rendus de retour d’expérience et actions décidées.',
    map: { iso27001: ['A.5.27', 'A.5.28'], recyf: ['12.5', '14.5'] },
  },

  // ── Continuité et crise ──────────────────────────────────────────────
  {
    key: 'continuite.bia', domain: 'continuite', frequency: 'annuelle',
    title: 'Bilan d’impact et objectifs de reprise',
    description: 'Pour chaque activité, la durée maximale d’interruption admissible et la perte de données acceptable sont fixées, en tenant compte des dépendances.',
    evidence: 'Bilan d’impact validé, avec DMIA et PDMA par activité.',
    map: { iso27001: ['A.5.30'], recyf: ['13.4', '13.7'], iso22301: ['6', '8.2'] },
  },
  {
    key: 'continuite.plans', domain: 'continuite', frequency: 'annuelle',
    title: 'Plans de continuité et de reprise',
    description: 'Des plans de continuité et de reprise couvrent les scénarios cyber et restent cohérents avec les objectifs de reprise.',
    evidence: 'Plans de continuité et de reprise à jour.',
    map: { iso27001: ['A.5.29', 'A.5.30'], recyf: ['13.6'], iso22301: ['8.4'], secnumcloud: ['17'] },
  },
  {
    key: 'continuite.crise', domain: 'continuite', frequency: 'annuelle',
    title: 'Dispositif de gestion de crise cyber',
    description: 'Critères d’activation, cellule, annuaire imprimé, moyens de communication de secours, mesures d’isolement et stratégie de communication sont prêts.',
    evidence: 'Procédure de crise, annuaire de crise imprimé et kit de communication.',
    map: { iso27001: ['A.5.29'], recyf: ['14.1', '14.2', '14.3', '14.4', '14.6', '14.7', '14.8', '14.9', '14.10'] },
  },
  {
    key: 'continuite.exercices', domain: 'continuite', frequency: 'annuelle',
    title: 'Exercices de continuité et de crise',
    description: 'Un programme d’exercices (sur table, techniques, de crise) est suivi ; chaque exercice donne lieu à un retour d’expérience.',
    evidence: 'Programme pluriannuel et comptes rendus d’exercices.',
    map: { iso27001: ['A.5.30'], recyf: ['15.1', '15.2', '15.3', '15.4'], iso22301: ['8.5'], dora: ['Ch.IV'] },
  },

  // ── Sécurité physique ────────────────────────────────────────────────
  {
    key: 'physique.acces', domain: 'physique', frequency: 'semestrielle',
    title: 'Contrôle des accès physiques',
    description: 'Les zones sont délimitées, l’accès aux locaux techniques est réservé aux personnes autorisées et les visiteurs sont enregistrés et accompagnés.',
    evidence: 'Liste des badges actifs et registre des visiteurs.',
    map: { iso27001: ['A.7.1', 'A.7.2', 'A.7.3', 'A.7.6'], recyf: ['6.1', '6.3', '6.4'] },
  },
  {
    key: 'physique.protection', domain: 'physique', frequency: 'annuelle',
    title: 'Protection des locaux techniques et des matériels',
    description: 'Les salles techniques sont surveillées et protégées des menaces environnementales ; énergie, climatisation, câblage et maintenance sont maîtrisés.',
    evidence: 'Rapports de maintenance et dispositifs de surveillance.',
    map: { iso27001: ['A.7.4', 'A.7.5', 'A.7.8', 'A.7.11', 'A.7.12', 'A.7.13'], recyf: ['6.2'] },
  },

  // ── Conformité et amélioration ───────────────────────────────────────
  {
    key: 'conformite.obligations', domain: 'conformite', frequency: 'annuelle',
    title: 'Registre des obligations légales et contractuelles',
    description: 'Les obligations légales, réglementaires et contractuelles, dont la propriété intellectuelle et la conservation des enregistrements, sont recensées et suivies.',
    evidence: 'Registre des obligations avec leur responsable.',
    map: { iso27001: ['A.5.31', 'A.5.32', 'A.5.33'] },
  },
  {
    key: 'conformite.donnees_personnelles', domain: 'conformite', frequency: 'annuelle',
    title: 'Registre des traitements et droits des personnes',
    description: 'Les traitements de données personnelles sont recensés avec leur base légale ; les personnes sont informées et leurs demandes traitées dans les délais.',
    evidence: 'Registre des traitements et suivi des demandes d’exercice de droits.',
    map: { iso27001: ['A.5.34'], rgpd: ['Art.5', 'Art.6', 'Art.13-14', 'Art.15-22', 'Art.30'], iso27701: ['7'] },
  },
  {
    key: 'conformite.aipd', domain: 'conformite', frequency: 'annuelle',
    title: 'Analyses d’impact sur la vie privée',
    description: 'Les traitements à risque élevé font l’objet d’une analyse d’impact avant leur mise en œuvre.',
    evidence: 'Analyses d’impact réalisées et avis du référent RGPD.',
    map: { iso27001: ['A.5.34'], rgpd: ['Art.35'] },
  },
  {
    key: 'conformite.audit', domain: 'conformite', frequency: 'annuelle',
    title: 'Programme d’audit et revue indépendante',
    description: 'Un programme d’audits internes et indépendants couvre les systèmes selon les risques ; les constats sont corrigés selon un plan d’action et les tests d’audit n’affectent pas la production.',
    evidence: 'Programme d’audit, rapports et plan d’action.',
    map: { iso27001: ['9.2', 'A.5.35', 'A.8.34'], recyf: ['17.1', '17.2', '17.3', '17.4', '17.5'], iso9001: ['9'] },
  },
  {
    key: 'conformite.actions_correctives', domain: 'conformite', frequency: 'trimestrielle',
    title: 'Non-conformités et actions correctives',
    description: 'Les non-conformités sont enregistrées, leurs causes analysées et les actions correctives vérifiées dans leur efficacité.',
    evidence: 'Registre des non-conformités et vérifications d’efficacité.',
    map: { iso27001: ['10.2'], iso9001: ['10'] },
  },
];

export interface ControlTemplateMapping {
  framework: ControlTemplateFramework;
  version: string;
  refs: string[];
}

export interface ControlTemplate {
  key: string;
  domain: ControlTemplateDomain;
  title: string;
  description: string;
  evidence: string;
  frequency: ControlTemplateFrequency;
  mappings: ControlTemplateMapping[];
}

let cached: ControlTemplate[] | undefined;

/**
 * Contrôles types avec leurs rattachements résolus : pour ReCyF, chaque
 * numéro de moyen est complété de son suffixe (« 2.B.1 » → « 2.B.1-EI/EE »),
 * tel qu'il figure en base.
 */
export function controlTemplates(): ControlTemplate[] {
  if (cached) return cached;
  const recyfRefs = new Map<string, string>();
  for (const o of recyf().objectives) for (const m of o.means) recyfRefs.set(m.ref.split('-')[0]!, m.ref);
  cached = DEFS.map((d) => ({
    key: d.key,
    domain: d.domain,
    title: d.title,
    description: d.description,
    evidence: d.evidence,
    frequency: d.frequency,
    mappings: (Object.keys(d.map) as ControlTemplateFramework[]).map((framework) => ({
      framework,
      version: CONTROL_TEMPLATE_FRAMEWORKS[framework],
      refs: d.map[framework]!.map((ref) => {
        if (framework !== 'recyf') return ref;
        const full = recyfRefs.get(ref);
        if (!full) throw new Error(`Contrôle type ${d.key} : moyen ReCyF inconnu ${ref}`);
        return full;
      }),
    })),
  }));
  return cached;
}
