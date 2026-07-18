import { pgEnum } from 'drizzle-orm/pg-core';

// Les énumérations sont des types Postgres (PLAN.md §4).

export const tenantPlan = pgEnum('tenant_plan', ['decouverte', 'standard', 'entreprise']);

export const membershipRole = pgEnum('membership_role', [
  'owner',
  'direction',
  'rssi',
  'resp_qualite',
  'pilote',
  'auditeur',
  'contributeur',
  'lecteur',
]);

export const scopeKind = pgEnum('scope_kind', ['smsi', 'qms', 'mixte']);

export const frameworkSource = pgEnum('framework_source', ['builtin', 'custom']);

export const controlStatus = pgEnum('control_status', ['brouillon', 'actif', 'archive']);

export const reviewFrequency = pgEnum('review_frequency', [
  'mensuelle',
  'trimestrielle',
  'semestrielle',
  'annuelle',
]);

export const assessmentStatus = pgEnum('assessment_status', [
  'planifiee',
  'en_cours',
  'cloturee',
]);

export const assessmentItemStatus = pgEnum('assessment_item_status', [
  'conforme',
  'ecart',
  'non_applicable',
  'a_evaluer',
]);

export const exportStatus = pgEnum('export_status', ['en_cours', 'scelle', 'echec']);

export const exportType = pgEnum('export_type', ['soa']);

export const riskTreatment = pgEnum('risk_treatment', [
  'reduire',
  'transferer',
  'accepter',
  'eviter',
]);

export const riskSource = pgEnum('risk_source', ['manual', 'ebios']);

export const riskBand = pgEnum('risk_band', ['faible', 'moyen', 'eleve', 'critique']);

export const actionOrigin = pgEnum('action_origin', [
  'risk',
  'finding',
  'incident',
  'nc',
  'assessment',
  'review',
  'manual',
]);

export const actionPriority = pgEnum('action_priority', ['p1', 'p2', 'p3']);

export const actionStatus = pgEnum('action_status', [
  'planifie',
  'en_cours',
  'termine',
  'verification',
]);

export const actionLinkTarget = pgEnum('action_link_target', ['requirement', 'control']);

export const documentType = pgEnum('document_type', [
  'pssi',
  'politique',
  'procedure',
  'charte',
  'pca_pra',
  'fiche_processus',
  'autre',
]);

export const documentVersionStatus = pgEnum('document_version_status', ['brouillon', 'publie']);

export const evidenceType = pgEnum('evidence_type', [
  'capture',
  'export',
  'attestation',
  'rapport',
  'pv',
]);

export const evidenceRecurrence = pgEnum('evidence_recurrence', [
  'ponctuelle',
  'trimestrielle',
  'semestrielle',
  'annuelle',
]);

export const evidenceAccessKind = pgEnum('evidence_access_kind', [
  'consultation',
  'telechargement',
]);

export const assetCategory = pgEnum('asset_category', [
  'materiel',
  'logiciel',
  'donnees',
  'flux',
]);
