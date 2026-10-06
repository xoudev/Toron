/**
 * Registre des obligations et qualification NIS 2 (module 6.4). Règles pures.
 * La qualification est indicative : elle applique les critères de secteur
 * (annexes I et II de la directive (UE) 2022/2555) et de taille
 * (recommandation 2003/361/CE) ; l'enregistrement sur MonEspaceNIS2 et une
 * éventuelle désignation par l'ANSSI font foi.
 */

export const NIS2_SECTORS = [
  { key: 'energie', label: 'Énergie', annex: 1 },
  { key: 'transports', label: 'Transports (aérien, ferroviaire, maritime, routier)', annex: 1 },
  { key: 'banque', label: 'Secteur bancaire', annex: 1 },
  { key: 'marches_financiers', label: 'Infrastructures des marchés financiers', annex: 1 },
  { key: 'sante', label: 'Santé', annex: 1 },
  { key: 'eau_potable', label: 'Eau potable', annex: 1 },
  { key: 'eaux_usees', label: 'Eaux usées', annex: 1 },
  { key: 'infrastructure_numerique', label: 'Infrastructures numériques', annex: 1 },
  { key: 'services_tic', label: 'Gestion des services TIC (interentreprises)', annex: 1 },
  { key: 'administration', label: 'Administration publique', annex: 1 },
  { key: 'espace', label: 'Espace', annex: 1 },
  { key: 'postal_expedition', label: 'Services postaux et d’expédition', annex: 2 },
  { key: 'dechets', label: 'Gestion des déchets', annex: 2 },
  { key: 'chimie', label: 'Produits chimiques (fabrication, distribution)', annex: 2 },
  { key: 'alimentaire', label: 'Denrées alimentaires (production, transformation, distribution)', annex: 2 },
  { key: 'fabrication', label: 'Fabrication (dispositifs médicaux, électronique, machines, véhicules…)', annex: 2 },
  { key: 'fournisseurs_numeriques', label: 'Fournisseurs numériques (places de marché, moteurs de recherche, réseaux sociaux)', annex: 2 },
  { key: 'recherche', label: 'Recherche', annex: 2 },
  { key: 'hors_champ', label: 'Aucun de ces secteurs', annex: 0 },
] as const;
export type Nis2Sector = (typeof NIS2_SECTORS)[number]['key'];
export const NIS2_SECTOR_KEYS = NIS2_SECTORS.map((s) => s.key) as unknown as readonly [Nis2Sector, ...Nis2Sector[]];

export function nis2Sector(key: string | null): (typeof NIS2_SECTORS)[number] | undefined {
  return NIS2_SECTORS.find((s) => s.key === key);
}

export type CompanySize = 'petite' | 'moyenne' | 'grande';

export const COMPANY_SIZE_LABEL: Record<CompanySize, string> = {
  petite: 'petite entreprise',
  moyenne: 'entreprise moyenne',
  grande: 'grande entreprise',
};

export interface EntitySizeInput {
  employees: number | null;
  /** Chiffre d'affaires annuel, en millions d'euros. */
  turnoverMeur: number | null;
  /** Total du bilan annuel, en millions d'euros. */
  balanceSheetMeur: number | null;
}

/**
 * Catégorie d'entreprise : grande dès 250 salariés, ou chiffre d'affaires
 * supérieur à 50 M€ et bilan supérieur à 43 M€ ; moyenne dès 50 salariés, ou
 * chiffre d'affaires et bilan supérieurs à 10 M€ ; petite sinon. Sans effectif
 * renseigné, la catégorie reste indéterminée (null).
 */
export function companySize(i: EntitySizeInput): CompanySize | null {
  if (i.employees === null) return null;
  const turnover = i.turnoverMeur ?? 0;
  const balance = i.balanceSheetMeur ?? 0;
  if (i.employees >= 250 || (turnover > 50 && balance > 43)) return 'grande';
  if (i.employees >= 50 || (turnover > 10 && balance > 10)) return 'moyenne';
  return 'petite';
}

export const NIS2_STATUSES = ['ee', 'ei', 'non_concernee'] as const;
export type Nis2Status = (typeof NIS2_STATUSES)[number];

export const NIS2_STATUS_LABEL: Record<Nis2Status | 'indeterminee', string> = {
  ee: 'Entité essentielle',
  ei: 'Entité importante',
  non_concernee: 'Non concernée',
  indeterminee: 'À qualifier',
};

export interface Nis2Input extends EntitySizeInput {
  sector: string | null;
  /** Qualification retenue par l'organisation (désignation, cas particulier). */
  override: Nis2Status | null;
}

export interface Nis2Qualification {
  status: Nis2Status | 'indeterminee';
  /** Résultat des seuls critères de secteur et de taille. */
  computed: Nis2Status | 'indeterminee';
  overridden: boolean;
  /** Explication en une phrase, affichable telle quelle. */
  reason: string;
}

export function nis2Qualification(i: Nis2Input): Nis2Qualification {
  const sector = nis2Sector(i.sector);
  const size = companySize(i);
  let computed: Nis2Status | 'indeterminee';
  let reason: string;
  if (!sector || size === null) {
    computed = 'indeterminee';
    reason = 'Renseignez le secteur d’activité et l’effectif pour obtenir une qualification indicative.';
  } else if (sector.annex === 0) {
    computed = 'non_concernee';
    reason = 'Activité hors des secteurs des annexes I et II de la directive NIS 2.';
  } else if (size === 'petite') {
    computed = 'non_concernee';
    reason = `${sector.label} (annexe ${sector.annex === 1 ? 'I' : 'II'}), mais ${COMPANY_SIZE_LABEL[size]} : sous les seuils de taille, sauf désignation.`;
  } else {
    computed = sector.annex === 1 && size === 'grande' ? 'ee' : 'ei';
    reason = `${sector.label} (annexe ${sector.annex === 1 ? 'I' : 'II'}), ${COMPANY_SIZE_LABEL[size]}.`;
  }
  if (i.override && i.override !== computed) {
    return { status: i.override, computed, overridden: true, reason: `${NIS2_STATUS_LABEL[i.override]} retenue par l’organisation — critères seuls : ${NIS2_STATUS_LABEL[computed].toLowerCase()}.` };
  }
  return { status: computed, computed, overridden: false, reason };
}

export const NIS2_REGISTRATION_STATES = ['a_faire', 'en_cours', 'enregistree', 'sans_objet'] as const;
export type Nis2Registration = (typeof NIS2_REGISTRATION_STATES)[number];

export const NIS2_REGISTRATION_LABEL: Record<Nis2Registration, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  enregistree: 'Enregistrée',
  sans_objet: 'Sans objet',
};

// ── Registre des obligations ────────────────────────────────────────────

export const OBLIGATION_REGIMES = ['nis2', 'rgpd', 'sectoriel', 'contractuel', 'autre'] as const;
export type ObligationRegime = (typeof OBLIGATION_REGIMES)[number];

export const OBLIGATION_REGIME_LABEL: Record<ObligationRegime, string> = {
  nis2: 'NIS 2',
  rgpd: 'RGPD',
  sectoriel: 'Sectoriel',
  contractuel: 'Contractuel',
  autre: 'Autre',
};

export const OBLIGATION_STATUSES = ['a_evaluer', 'en_cours', 'conforme', 'non_applicable'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const OBLIGATION_STATUS_LABEL: Record<ObligationStatus, string> = {
  a_evaluer: 'À évaluer',
  en_cours: 'En cours',
  conforme: 'Respectée',
  non_applicable: 'Non applicable',
};

export interface ObligationTemplate {
  key: string;
  regime: ObligationRegime;
  title: string;
  source: string;
  /** Qualifications NIS 2 concernées ; absent = toute organisation traitant des données personnelles. */
  nis2?: readonly Nis2Status[];
}

/** Obligations proposées selon la qualification. Intitulés rédigés par Toron ; sources publiques. */
export const OBLIGATION_CATALOG: readonly ObligationTemplate[] = [
  { key: 'nis2_enregistrement', regime: 'nis2', nis2: ['ee', 'ei'], title: 'S’enregistrer auprès de l’ANSSI (MonEspaceNIS2) et tenir les informations à jour', source: 'Directive (UE) 2022/2555, art. 3 et 27' },
  { key: 'nis2_gouvernance', regime: 'nis2', nis2: ['ee', 'ei'], title: 'Faire approuver les mesures de cybersécurité par la direction et former ses membres', source: 'Directive (UE) 2022/2555, art. 20' },
  { key: 'nis2_mesures', regime: 'nis2', nis2: ['ee', 'ei'], title: 'Mettre en œuvre les mesures de gestion des risques de cybersécurité (référentiel ReCyF)', source: 'Directive (UE) 2022/2555, art. 21' },
  { key: 'nis2_chaine', regime: 'nis2', nis2: ['ee', 'ei'], title: 'Maîtriser la sécurité de la chaîne d’approvisionnement et des fournisseurs directs', source: 'Directive (UE) 2022/2555, art. 21, § 2, d)' },
  { key: 'nis2_notification', regime: 'nis2', nis2: ['ee', 'ei'], title: 'Notifier les incidents importants : alerte sous 24 h, notification sous 72 h, rapport final sous un mois', source: 'Directive (UE) 2022/2555, art. 23' },
  { key: 'nis2_controle', regime: 'nis2', nis2: ['ee', 'ei'], title: 'Se tenir prêt aux contrôles de l’autorité et conserver les justificatifs', source: 'Directive (UE) 2022/2555, art. 32 et 33' },
  { key: 'rgpd_registre', regime: 'rgpd', title: 'Tenir le registre des activités de traitement', source: 'Règlement (UE) 2016/679, art. 30' },
  { key: 'rgpd_information', regime: 'rgpd', title: 'Informer les personnes concernées sur les traitements de leurs données', source: 'Règlement (UE) 2016/679, art. 13 et 14' },
  { key: 'rgpd_droits', regime: 'rgpd', title: 'Répondre aux demandes d’exercice des droits dans un délai d’un mois', source: 'Règlement (UE) 2016/679, art. 12 et 15 à 22' },
  { key: 'rgpd_sous_traitants', regime: 'rgpd', title: 'Encadrer chaque sous-traitant par un contrat conforme', source: 'Règlement (UE) 2016/679, art. 28' },
  { key: 'rgpd_violations', regime: 'rgpd', title: 'Documenter les violations de données, les notifier à la CNIL sous 72 h et informer les personnes en cas de risque élevé', source: 'Règlement (UE) 2016/679, art. 33 et 34' },
  { key: 'rgpd_dpo', regime: 'rgpd', title: 'Évaluer l’obligation de désigner un délégué à la protection des données', source: 'Règlement (UE) 2016/679, art. 37' },
];

/** Obligations du catalogue applicables à une entité, d'après sa qualification NIS 2. */
export function suggestedObligations(status: Nis2Status | 'indeterminee'): ObligationTemplate[] {
  return OBLIGATION_CATALOG.filter((o) => !o.nis2 || (status !== 'indeterminee' && o.nis2.includes(status)));
}

/** Une obligation écartée doit dire pourquoi : c'est ce qu'un contrôleur demandera. */
export function obligationJustificationRequired(status: ObligationStatus): boolean {
  return status === 'non_applicable';
}

export type ObligationAttention = 'en_retard' | 'proche' | 'aucune';

/** Échéance dépassée ou à moins de 30 jours, pour une obligation encore ouverte. */
export function obligationAttention(status: ObligationStatus, dueDate: string | null, today: string): ObligationAttention {
  if (!dueDate || status === 'conforme' || status === 'non_applicable') return 'aucune';
  const day = today.slice(0, 10);
  if (dueDate < day) return 'en_retard';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const limit = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10);
  return dueDate <= limit ? 'proche' : 'aucune';
}
