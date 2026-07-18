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
