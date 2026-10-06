import 'server-only';

import {
  OBLIGATION_REGIME_LABEL,
  OBLIGATION_STATUS_LABEL,
  SUPPLIER_RATING_LABEL,
  refCodeFor,
  type CsvColumn,
  type SearchKind,
} from '@toron/core';
import {
  listActions, listAssets, listControls, listDocuments, listEvidences, listIncidents, listNc, listRisks,
  listObligations, listSuppliers, type TenantTx,
} from '@toron/db';

// Définition des exports CSV de chaque registre : colonnes lisibles par un
// auditeur, codes identiques à ceux de l'interface, aucune donnée binaire.

const BAND: Record<string, string> = { faible: 'Faible', moyen: 'Moyen', eleve: 'Élevé', critique: 'Critique' };
const TREATMENT: Record<string, string> = { reduire: 'Réduire', transferer: 'Transférer', accepter: 'Accepter', eviter: 'Éviter' };
const ACCEPTANCE: Record<string, string> = { non_requise: 'Non requise', en_attente: 'En attente', acceptee: 'Acceptée', expiree: 'Expirée' };
const ACTION_STATUS: Record<string, string> = { planifie: 'Planifiée', en_cours: 'En cours', verification: 'Vérification', termine: 'Terminée', en_retard: 'En retard' };
const PRIORITY: Record<string, string> = { p1: 'P1 — haute', p2: 'P2 — moyenne', p3: 'P3 — basse' };
const ORIGIN: Record<string, string> = { risk: 'Risque', finding: 'Constat d’audit', incident: 'Incident', nc: 'Non-conformité', assessment: 'Évaluation', review: 'Revue de direction', manual: 'Manuel' };
const TIER: Record<string, string> = { t1: 'T1 — critique', t2: 'T2', t3: 'T3' };
const CONTRACT: Record<string, string> = { a_faire: 'À faire', en_cours: 'En cours', conforme: 'Conforme' };
const SEVERITY: Record<string, string> = { mineur: 'Mineur', majeur: 'Majeur', critique: 'Critique' };
const INCIDENT_STATUS: Record<string, string> = { ouvert: 'Ouvert', qualifie: 'Qualifié', clos: 'Clos' };
const NC_STATUS: Record<string, string> = { ouverte: 'Ouverte', en_traitement: 'En traitement', cloturee_a_verifier: 'Clôturée, efficacité à vérifier', efficace: 'Efficace', rouverte: 'Rouverte' };
const GRAVITY: Record<string, string> = { mineure: 'Mineure', majeure: 'Majeure', critique: 'Critique' };
const NC_SOURCE: Record<string, string> = { interne: 'Interne', fournisseur: 'Fournisseur', reclamation_client: 'Réclamation client' };
const FRESHNESS: Record<string, string> = { fraiche: 'Valide', bientot: 'À renouveler sous 30 jours', expiree: 'Expirée', permanente: 'Sans échéance' };

const code = (kind: SearchKind) => (r: { id: string }) => refCodeFor(kind, r.id);
const label = (map: Record<string, string>, v: string | null | undefined) => (v ? (map[v] ?? v) : '');

interface RegisterExport<T> {
  title: string;
  load: (tx: TenantTx) => Promise<T[]>;
  columns: CsvColumn<T>[];
}

function register<T>(def: RegisterExport<T>): RegisterExport<unknown> {
  return def as unknown as RegisterExport<unknown>;
}

export const REGISTER_EXPORTS = {
  risques: register({
    title: 'Registre des risques',
    load: (tx) => listRisks(tx),
    columns: [
      { header: 'Code', value: code('risque') },
      { header: 'Risque', value: (r) => r.title },
      { header: 'Périmètre', value: (r) => r.scopeName },
      { header: 'Scénario', value: (r) => r.scenario },
      { header: 'Valeur métier', value: (r) => r.businessValue },
      { header: 'Gravité brute', value: (r) => r.grossG },
      { header: 'Vraisemblance brute', value: (r) => r.grossV },
      { header: 'Niveau brut', value: (r) => label(BAND, r.grossBand) },
      { header: 'Gravité nette', value: (r) => r.netG },
      { header: 'Vraisemblance nette', value: (r) => r.netV },
      { header: 'Niveau net', value: (r) => label(BAND, r.netBand) },
      { header: 'Cible résiduelle', value: (r) => label(BAND, r.residualTarget) },
      { header: 'Traitement', value: (r) => label(TREATMENT, r.treatment) },
      { header: 'Contrôles liés', value: (r) => r.controlCount },
      { header: 'Propriétaire', value: (r) => r.ownerName },
      { header: 'Prochaine revue', value: (r) => r.nextReview },
      { header: 'Acceptation', value: (r) => label(ACCEPTANCE, r.acceptanceState) },
      { header: 'Acceptée par', value: (r) => r.acceptedByName },
      { header: 'Acceptation expire le', value: (r) => r.acceptanceExpiresAt },
    ],
  }),
  actions: register({
    title: 'Plan d’action',
    load: (tx) => listActions(tx),
    columns: [
      { header: 'Code', value: code('action') },
      { header: 'Action', value: (r) => r.title },
      { header: 'Description', value: (r) => r.description },
      { header: 'Origine', value: (r) => label(ORIGIN, r.originType) },
      { header: 'Statut', value: (r) => label(ACTION_STATUS, r.effectiveStatus) },
      { header: 'Priorité', value: (r) => label(PRIORITY, r.priority) },
      { header: 'Propriétaire', value: (r) => r.ownerName },
      { header: 'Échéance', value: (r) => r.dueDate },
      { header: 'Charge (jours)', value: (r) => r.effort },
      { header: 'Sous-tâches faites', value: (r) => r.subtaskDone },
      { header: 'Sous-tâches', value: (r) => r.subtaskTotal },
      { header: 'Exigences et contrôles liés', value: (r) => r.linkCount },
    ],
  }),
  actifs: register({
    title: 'Cartographie des actifs',
    load: (tx) => listAssets(tx),
    columns: [
      { header: 'Code', value: code('actif') },
      { header: 'Actif', value: (r) => r.name },
      { header: 'Catégorie', value: (r) => r.category },
      { header: 'Description', value: (r) => r.description },
      { header: 'Périmètre', value: (r) => r.scopeName },
      { header: 'Propriétaire', value: (r) => r.ownerName },
      { header: 'Disponibilité', value: (r) => r.dicp.d },
      { header: 'Intégrité', value: (r) => r.dicp.i },
      { header: 'Confidentialité', value: (r) => r.dicp.c },
      { header: 'Preuve', value: (r) => r.dicp.p },
      { header: 'Sensibilité', value: (r) => r.sensitivity },
      { header: 'Risques liés', value: (r) => r.riskCount },
    ],
  }),
  fournisseurs: register({
    title: 'Registre des fournisseurs',
    load: (tx) => listSuppliers(tx),
    columns: [
      { header: 'Code', value: code('fournisseur') },
      { header: 'Fournisseur', value: (r) => r.name },
      { header: 'Niveau', value: (r) => label(TIER, r.tier) },
      { header: 'Services', value: (r) => r.services },
      { header: 'Données confiées', value: (r) => r.dataCategories.join(', ') },
      { header: 'Clauses contractuelles', value: (r) => label(CONTRACT, r.contractStatus) },
      { header: 'Dernière évaluation', value: (r) => r.lastAssessedOn },
      { header: 'Note /100', value: (r) => r.lastScore },
      { header: 'Appréciation', value: (r) => (r.lastRating ? SUPPLIER_RATING_LABEL[r.lastRating] : null) },
      { header: 'Prochaine échéance d’attestation', value: (r) => r.nextAttestationExpiry },
      { header: 'Actions ouvertes', value: (r) => r.openActionCount },
      { header: 'Propriétaire', value: (r) => r.ownerName },
      { header: 'Prochaine revue', value: (r) => r.nextReview },
    ],
  }),
  obligations: register({
    title: 'Registre des obligations',
    load: (tx) => listObligations(tx),
    columns: [
      { header: 'Code', value: code('obligation') },
      { header: 'Obligation', value: (r) => r.title },
      { header: 'Régime', value: (r) => label(OBLIGATION_REGIME_LABEL, r.regime) },
      { header: 'Source', value: (r) => r.source },
      { header: 'Entité', value: (r) => r.entityName },
      { header: 'Statut', value: (r) => label(OBLIGATION_STATUS_LABEL, r.status) },
      { header: 'Justification', value: (r) => r.justification },
      { header: 'Responsable', value: (r) => r.ownerName },
      { header: 'Échéance', value: (r) => r.dueDate },
    ],
  }),
  incidents: register({
    title: 'Registre des incidents',
    load: (tx) => listIncidents(tx),
    columns: [
      { header: 'Code', value: code('incident') },
      { header: 'Incident', value: (r) => r.title },
      { header: 'Gravité', value: (r) => label(SEVERITY, r.severity) },
      { header: 'Statut', value: (r) => label(INCIDENT_STATUS, r.status) },
      { header: 'Ouvert le', value: (r) => r.openedAt },
      { header: 'Qualifié le', value: (r) => r.qualifiedAt },
      { header: 'Incident important NIS 2', value: (r) => r.nis2Important },
      { header: 'Violation de données (RGPD)', value: (r) => r.gdprBreach },
      { header: 'Responsable', value: (r) => r.ownerName },
    ],
  }),
  'non-conformites': register({
    title: 'Registre des non-conformités',
    load: (tx) => listNc(tx),
    columns: [
      { header: 'Code', value: code('nc') },
      { header: 'Non-conformité', value: (r) => r.title },
      { header: 'Source', value: (r) => label(NC_SOURCE, r.source) },
      { header: 'Gravité', value: (r) => label(GRAVITY, r.gravity) },
      { header: 'Processus', value: (r) => r.processRef },
      { header: 'Coût de non-qualité estimé (€)', value: (r) => r.costEstimate },
      { header: 'Statut', value: (r) => label(NC_STATUS, r.status) },
      { header: 'Responsable', value: (r) => r.ownerName },
      { header: 'Vérification d’efficacité', value: (r) => r.effectivenessCheckAt },
      { header: 'Actions correctives', value: (r) => r.correctiveActionCount },
    ],
  }),
  documents: register({
    title: 'Registre documentaire',
    load: (tx) => listDocuments(tx),
    columns: [
      { header: 'Code', value: code('document') },
      { header: 'Document', value: (r) => r.title },
      { header: 'Type', value: (r) => r.type },
      { header: 'Périmètre', value: (r) => r.scopeName },
      { header: 'Processus', value: (r) => r.processName },
      { header: 'Propriétaire', value: (r) => r.ownerName },
      { header: 'Version', value: (r) => r.latestSemver },
      { header: 'État de la version', value: (r) => (r.latestStatus === 'publie' ? 'Publiée' : r.latestStatus === 'brouillon' ? 'Brouillon' : '') },
      { header: 'Revue prévue', value: (r) => r.reviewDue },
      { header: 'Revue dépassée', value: (r) => r.reviewOverdue },
      { header: 'Exigences couvertes', value: (r) => r.requirementCount },
    ],
  }),
  preuves: register({
    title: 'Coffre de preuves',
    load: (tx) => listEvidences(tx),
    columns: [
      { header: 'Code', value: code('preuve') },
      { header: 'Preuve', value: (r) => r.title },
      { header: 'Type', value: (r) => r.type },
      { header: 'Fichier', value: (r) => r.fileName },
      { header: 'Empreinte SHA-256', value: (r) => r.sha256 },
      { header: 'Collectée le', value: (r) => r.collectedAt },
      { header: 'Valide jusqu’au', value: (r) => r.validUntil },
      { header: 'Récurrence', value: (r) => r.recurrence },
      { header: 'Fraîcheur', value: (r) => label(FRESHNESS, r.freshness) },
      { header: 'Collecteur', value: (r) => r.collectorName },
      { header: 'Éléments couverts', value: (r) => r.linkCount },
    ],
  }),
  controles: register({
    title: 'Contrôles internes',
    load: (tx) => listControls(tx),
    columns: [
      { header: 'Contrôle', value: (r) => r.title },
      { header: 'Statut', value: (r) => r.status },
      { header: 'Exigences couvertes', value: (r) => r.mappedRequirementCount },
      { header: 'Référentiels', value: (r) => r.frameworkCodes.join(', ').toUpperCase() },
      { header: 'Mutualisé', value: (r) => r.mutualized },
    ],
  }),
} as const;

export type RegisterKey = keyof typeof REGISTER_EXPORTS;
export const REGISTER_KEYS = Object.keys(REGISTER_EXPORTS) as [RegisterKey, ...RegisterKey[]];
