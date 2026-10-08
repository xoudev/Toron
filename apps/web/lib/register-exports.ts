import 'server-only';

import {
  ACTIVITY_CONTINUITY_STATE_LABEL,
  CONTROL_REVIEW_RESULT_LABEL,
  CONTROL_REVIEW_STATE_LABEL,
  CRITICALITY_LABEL,
  EXERCISE_RESULT_LABEL,
  SURVEY_METHOD_LABEL,
  SURVEY_VERDICT_LABEL,
  EXCEPTION_STATE_LABEL,
  LEGAL_BASIS_LABEL,
  OBLIGATION_REGIME_LABEL,
  OBLIGATION_STATUS_LABEL,
  REVIEW_FREQUENCY_LABEL,
  SUPPLIER_RATING_LABEL,
  TRAINING_KIND_LABEL,
  TRAINING_SESSION_STATE_LABEL,
  refCodeFor,
  type CsvColumn,
  type SearchKind,
} from '@toron/core';
import {
  listActions, listAssets, listControlLibrary, listDocuments, listEvidences, listExceptions, listIncidents, listNc, listRisks,
  listContinuityActivities, listCustomerSurveys, listObligations, listProcessing, listSuppliers, listTrainingSessions, type TenantTx,
} from '@toron/db';

import { todayParis } from '@/lib/format';

// Définition des exports CSV de chaque registre : colonnes lisibles par un
// auditeur, codes identiques à ceux de l'interface, aucune donnée binaire.

const BAND: Record<string, string> = { faible: 'Faible', moyen: 'Moyen', eleve: 'Élevé', critique: 'Critique' };
const TREATMENT: Record<string, string> = { reduire: 'Réduire', transferer: 'Transférer', accepter: 'Accepter', eviter: 'Éviter' };
const ACCEPTANCE: Record<string, string> = { non_requise: 'Non requise', en_attente: 'En attente', acceptee: 'Acceptée', expiree: 'Expirée' };
const TREATMENT_PLAN: Record<string, string> = { sans_objet: 'Sans objet (acceptation)', cible_atteinte: 'Cible atteinte', non_planifie: 'Non planifié', a_recoter: 'À recoter', en_retard: 'En retard', en_cours: 'En cours' };
const ACTION_STATUS: Record<string, string> = { planifie: 'Planifiée', en_cours: 'En cours', verification: 'Vérification', termine: 'Terminée', en_retard: 'En retard' };
const PRIORITY: Record<string, string> = { p1: 'P1 — haute', p2: 'P2 — moyenne', p3: 'P3 — basse' };
const ORIGIN: Record<string, string> = { risk: 'Risque', finding: 'Constat d’audit', incident: 'Incident', nc: 'Non-conformité', assessment: 'Évaluation', review: 'Revue de direction', manual: 'Manuel', supplier: 'Fournisseur', control: 'Revue de contrôle', exercise: 'Exercice de continuité' };
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
      { header: 'Plan de traitement', value: (r) => label(TREATMENT_PLAN, r.treatmentPlan) },
      { header: 'Actions ouvertes', value: (r) => r.openActionCount },
      { header: 'Actions en retard', value: (r) => r.overdueActionCount },
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
  traitements: register({
    title: 'Registre des activités de traitement (RGPD, art. 30)',
    load: (tx) => listProcessing(tx),
    columns: [
      { header: 'Code', value: code('traitement') },
      { header: 'Traitement', value: (r) => r.name },
      { header: 'Finalité', value: (r) => r.purpose },
      { header: 'Base légale', value: (r) => label(LEGAL_BASIS_LABEL, r.legalBasis) },
      { header: 'Précision sur la base légale', value: (r) => r.legalBasisDetail },
      { header: 'Personnes concernées', value: (r) => r.dataSubjects.join(', ') },
      { header: 'Catégories de données', value: (r) => r.dataCategories.join(', ') },
      { header: 'Données sensibles', value: (r) => (r.sensitiveData ? 'Oui' : 'Non') },
      { header: 'Destinataires', value: (r) => r.recipients },
      { header: 'Sous-traitants', value: (r) => r.processors.map((x) => x.name).join(', ') },
      { header: 'Transferts hors UE', value: (r) => (r.transfersOutsideEu ? 'Oui' : 'Non') },
      { header: 'Garanties des transferts', value: (r) => r.transferSafeguards },
      { header: 'Durée de conservation', value: (r) => r.retention },
      { header: 'Mesures de sécurité', value: (r) => r.securityMeasures },
      { header: 'Responsable', value: (r) => r.ownerName },
      { header: 'Dernière relecture', value: (r) => r.lastReviewedOn },
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
    load: (tx) => listControlLibrary(tx, todayParis()),
    columns: [
      { header: 'Contrôle', value: (r) => r.title },
      { header: 'Statut', value: (r) => r.status },
      { header: 'Responsable', value: (r) => r.ownerName },
      { header: 'Exigences couvertes', value: (r) => r.mappedRequirementCount },
      { header: 'Référentiels', value: (r) => r.frameworkCodes.join(', ').toUpperCase() },
      { header: 'Mutualisé', value: (r) => r.mutualized },
      { header: 'Fréquence de revue', value: (r) => (r.frequency ? REVIEW_FREQUENCY_LABEL[r.frequency] : null) },
      { header: 'Dernière revue', value: (r) => r.lastReviewedOn },
      { header: 'Résultat', value: (r) => (r.lastResult ? CONTROL_REVIEW_RESULT_LABEL[r.lastResult] : null) },
      { header: 'Prochaine revue', value: (r) => r.nextReviewOn },
      { header: 'Suivi', value: (r) => CONTROL_REVIEW_STATE_LABEL[r.reviewState] },
    ],
  }),
  derogations: register({
    title: 'Registre des dérogations',
    load: (tx) => listExceptions(tx, todayParis()),
    columns: [
      { header: 'Code', value: code('derogation') },
      { header: 'Dérogation', value: (r) => r.title },
      { header: 'Règle concernée', value: (r) => r.rule },
      { header: 'Contrôle', value: (r) => r.controlTitle },
      { header: 'Actif', value: (r) => r.assetName },
      { header: 'Justification', value: (r) => r.justification },
      { header: 'Mesures compensatoires', value: (r) => r.compensatingMeasures },
      { header: 'Demandeur', value: (r) => r.requesterName },
      { header: 'Responsable', value: (r) => r.ownerName },
      { header: 'Début', value: (r) => r.startsOn },
      { header: 'Fin', value: (r) => r.expiresOn },
      { header: 'État', value: (r) => EXCEPTION_STATE_LABEL[r.state] },
      { header: 'Décidée par', value: (r) => r.deciderName },
      { header: 'Décidée le', value: (r) => (r.decidedAt ? r.decidedAt.toISOString().slice(0, 10) : null) },
      { header: 'Conditions ou motif', value: (r) => r.decisionNote },
      { header: 'Clôturée le', value: (r) => (r.closedAt ? r.closedAt.toISOString().slice(0, 10) : null) },
      { header: 'Renouvelle', value: (r) => (r.renewedFromId ? refCodeFor('derogation', r.renewedFromId) : null) },
    ],
  }),
  sensibilisation: register({
    title: 'Registre de sensibilisation et de formation',
    load: (tx) => listTrainingSessions(tx, todayParis()),
    columns: [
      { header: 'Date', value: (r) => r.heldOn },
      { header: 'Session', value: (r) => r.title },
      { header: 'Type', value: (r) => TRAINING_KIND_LABEL[r.kind] },
      { header: 'État', value: (r) => TRAINING_SESSION_STATE_LABEL[r.state] },
      { header: 'Durée (minutes)', value: (r) => r.durationMinutes },
      { header: 'Public', value: (r) => r.audience },
      { header: 'Attendus', value: (r) => r.expectedCount },
      { header: 'Présents', value: (r) => r.attendedCount },
      { header: 'Membres présents', value: (r) => r.attendees.map((a) => a.name ?? 'Ancien membre').join(', ') },
      { header: 'Intervenant', value: (r) => r.provider },
      { header: 'Feuille d’émargement', value: (r) => r.evidenceTitle },
      { header: 'Notes', value: (r) => r.notes },
    ],
  }),
  continuite: register({
    title: 'Bilan d’impact des activités critiques',
    load: (tx) => listContinuityActivities(tx, todayParis()),
    columns: [
      { header: 'Activité', value: (r) => r.name },
      { header: 'Criticité', value: (r) => CRITICALITY_LABEL[r.criticality] },
      { header: 'DMIA (heures)', value: (r) => r.rtoHours },
      { header: 'PDMA (heures)', value: (r) => r.rpoHours },
      { header: 'Responsable', value: (r) => r.ownerName },
      { header: 'Processus', value: (r) => r.processName },
      { header: 'Actifs', value: (r) => r.assets.map((a) => a.name).join(', ') },
      { header: 'Fournisseurs', value: (r) => r.suppliers.map((s) => s.name).join(', ') },
      { header: 'Mode dégradé', value: (r) => r.degradedMode },
      { header: 'Plan de continuité', value: (r) => r.planDocumentTitle },
      { header: 'Bilan d’impact du', value: (r) => r.assessedOn },
      { header: 'À revoir avant', value: (r) => r.biaDueOn },
      { header: 'Dernier exercice', value: (r) => r.lastExercise?.heldOn ?? null },
      { header: 'Résultat', value: (r) => (r.lastExercise ? EXERCISE_RESULT_LABEL[r.lastExercise.result] : null) },
      { header: 'Reprise mesurée (minutes)', value: (r) => r.lastExercise?.recoveryMinutes ?? null },
      { header: 'État', value: (r) => ACTIVITY_CONTINUITY_STATE_LABEL[r.state] },
      { header: 'Prochain exercice', value: (r) => r.nextExerciseOn },
    ],
  }),
  satisfaction: register({
    title: 'Enquêtes de satisfaction client',
    load: (tx) => listCustomerSurveys(tx),
    columns: [
      { header: 'Clôture', value: (r) => r.closedOn },
      { header: 'Enquête', value: (r) => r.title },
      { header: 'Méthode', value: (r) => SURVEY_METHOD_LABEL[r.method] },
      { header: 'Segment', value: (r) => r.segment },
      { header: 'Sollicités', value: (r) => r.invitedCount },
      { header: 'Répondants', value: (r) => r.respondents },
      { header: 'Promoteurs', value: (r) => r.promoters },
      { header: 'Passifs', value: (r) => r.passives },
      { header: 'Détracteurs', value: (r) => r.detractors },
      { header: 'Satisfaits', value: (r) => r.satisfied },
      { header: 'Score', value: (r) => r.score },
      { header: 'Objectif', value: (r) => r.target },
      { header: 'Verdict', value: (r) => SURVEY_VERDICT_LABEL[r.verdict] },
      { header: 'Score précédent', value: (r) => r.previousScore },
      { header: 'Enseignements', value: (r) => r.findings },
      { header: 'Rapport', value: (r) => r.evidenceTitle },
    ],
  }),
} as const;

export type RegisterKey = keyof typeof REGISTER_EXPORTS;
export const REGISTER_KEYS = Object.keys(REGISTER_EXPORTS) as [RegisterKey, ...RegisterKey[]];
