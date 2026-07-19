import { acceptanceNeedsAttention, acceptanceState, riskBand, type RiskBand } from '@toron/core';
import { sql } from 'drizzle-orm';

import type { TenantTx } from '../tenant.ts';
import { getActiveScale } from './risks.ts';

// ── Indicateurs du tableau de bord (module 5.11, MVP v1 simple) ────────
// Agrégation en lecture seule sur les données des modules 5.2→5.7. Volumétrie
// PME/ETI faible : quelques comptages SQL + une passe cœur pour les bandes de
// risque (qui dépendent de l'échelle jsonb).

export interface DashboardMetrics {
  frameworksActive: number;
  controlsTotal: number;
  controlsMutualized: number;
  coveragePct: number | null;
  gaps: number;
  risksTotal: number;
  risksByBand: Record<RiskBand, number>;
  risksAttention: number;
  actionsOpen: number;
  actionsOverdue: number;
  evidencesTotal: number;
  evidencesStale: number;
  documentsTotal: number;
  documentsReviewOverdue: number;
}

interface RawCounts {
  frameworks_active: number | string;
  controls_total: number | string;
  controls_mutualized: number | string;
  cov_conforme: number | string;
  cov_applicable: number | string;
  gaps: number | string;
  actions_open: number | string;
  actions_overdue: number | string;
  evidences_total: number | string;
  evidences_stale: number | string;
  documents_total: number | string;
  documents_review_overdue: number | string;
}

export async function getDashboardMetrics(tx: TenantTx): Promise<DashboardMetrics> {
  const [raw] = (await tx.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (framework_id) id FROM assessments ORDER BY framework_id, created_at DESC
    )
    SELECT
      (SELECT count(DISTINCT framework_id) FROM scope_frameworks) AS frameworks_active,
      (SELECT count(*) FROM controls) AS controls_total,
      (SELECT count(*) FROM mutualized_controls) AS controls_mutualized,
      (SELECT count(*) FROM assessment_items WHERE assessment_id IN (SELECT id FROM latest) AND status = 'conforme') AS cov_conforme,
      (SELECT count(*) FROM assessment_items WHERE assessment_id IN (SELECT id FROM latest) AND status <> 'non_applicable') AS cov_applicable,
      (SELECT count(*) FROM assessment_items WHERE assessment_id IN (SELECT id FROM latest) AND status = 'ecart') AS gaps,
      (SELECT count(*) FROM actions WHERE status <> 'termine') AS actions_open,
      (SELECT count(*) FROM actions WHERE due_date < CURRENT_DATE AND status NOT IN ('termine', 'verification')) AS actions_overdue,
      (SELECT count(*) FROM evidences) AS evidences_total,
      (SELECT count(*) FROM evidences WHERE valid_until IS NOT NULL AND valid_until <= CURRENT_DATE + 30) AS evidences_stale,
      (SELECT count(*) FROM documents) AS documents_total,
      (SELECT count(*) FROM documents WHERE review_due < CURRENT_DATE) AS documents_review_overdue
  `)) as unknown as RawCounts[];

  // Bandes de risque (dépendent de l'échelle) + acceptations à traiter.
  const active = await getActiveScale(tx);
  const now = new Date();
  const risksByBand: Record<RiskBand, number> = { faible: 0, moyen: 0, eleve: 0, critique: 0 };
  let risksTotal = 0;
  let risksAttention = 0;
  if (active) {
    const rows = (await tx.execute(sql`
      SELECT r.net_g, r.net_v, r.treatment,
        (SELECT ra.expires_at::text FROM risk_acceptances ra WHERE ra.risk_id = r.id ORDER BY ra.accepted_at DESC LIMIT 1) AS expires_at,
        (SELECT ra.accepted_at::text FROM risk_acceptances ra WHERE ra.risk_id = r.id ORDER BY ra.accepted_at DESC LIMIT 1) AS accepted_at
      FROM risks r
    `)) as unknown as {
      net_g: number | string;
      net_v: number | string;
      treatment: string;
      expires_at: string | null;
      accepted_at: string | null;
    }[];
    risksTotal = rows.length;
    for (const r of rows) {
      const band = riskBand(Number(r.net_g), Number(r.net_v), active.scale);
      if (band) risksByBand[band] += 1;
      const state = acceptanceState(
        {
          treatment: r.treatment as 'reduire' | 'transferer' | 'accepter' | 'eviter',
          acceptance: r.accepted_at
            ? { acceptedAt: new Date(r.accepted_at), expiresAt: r.expires_at ? new Date(r.expires_at) : null }
            : null,
        },
        now,
      );
      if (acceptanceNeedsAttention(state)) risksAttention += 1;
    }
  }

  return {
    frameworksActive: Number(raw!.frameworks_active),
    controlsTotal: Number(raw!.controls_total),
    controlsMutualized: Number(raw!.controls_mutualized),
    coveragePct:
      Number(raw!.cov_applicable) === 0
        ? null
        : Math.round((Number(raw!.cov_conforme) / Number(raw!.cov_applicable)) * 100),
    gaps: Number(raw!.gaps),
    risksTotal,
    risksByBand,
    risksAttention,
    actionsOpen: Number(raw!.actions_open),
    actionsOverdue: Number(raw!.actions_overdue),
    evidencesTotal: Number(raw!.evidences_total),
    evidencesStale: Number(raw!.evidences_stale),
    documentsTotal: Number(raw!.documents_total),
    documentsReviewOverdue: Number(raw!.documents_review_overdue),
  };
}

export interface DashboardExtras {
  auditsInProgress: number;
  ncOpen: number;
  incidentsOpen: number;
  processesTotal: number;
  reviewsHeld: number;
  frameworksAvailable: number;
  requirementsTotal: number;
}

/**
 * Compteurs complémentaires « système de management » pour enrichir le
 * tableau de bord (audits, NC, incidents, processus, revues, catalogue). La
 * santé des processus est dérivée côté application via listProcesses — on ne
 * la calcule pas ici pour éviter d'interroger le jsonb des indicateurs.
 */
export async function getDashboardExtras(tx: TenantTx): Promise<DashboardExtras> {
  const rows = await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM audits WHERE status = 'en_cours') AS audits_in_progress,
      (SELECT count(*) FROM nonconformities WHERE status IN ('ouverte','en_traitement','rouverte')) AS nc_open,
      (SELECT count(*) FROM incidents WHERE status IN ('ouvert','qualifie')) AS incidents_open,
      (SELECT count(*) FROM processes) AS processes_total,
      (SELECT count(*) FROM management_reviews WHERE status = 'tenue') AS reviews_held,
      (SELECT count(*) FROM frameworks f WHERE NOT EXISTS
         (SELECT 1 FROM framework_visibility fv WHERE fv.framework_id = f.id AND fv.hidden)) AS frameworks_available,
      (SELECT count(*) FROM requirements) AS requirements_total
  `);
  const r = (rows as unknown as Record<string, number | string>[])[0]!;
  return {
    auditsInProgress: Number(r['audits_in_progress']),
    ncOpen: Number(r['nc_open']),
    incidentsOpen: Number(r['incidents_open']),
    processesTotal: Number(r['processes_total']),
    reviewsHeld: Number(r['reviews_held']),
    frameworksAvailable: Number(r['frameworks_available']),
    requirementsTotal: Number(r['requirements_total']),
  };
}
