import 'server-only';

import {
  OBLIGATION_REGIMES,
  acceptanceNeedsAttention,
  attestationFreshness,
  boardDecisions,
  boardMessages,
  nis2Qualification,
  obligationAttention,
  processingGaps,
  processorAgreementState,
  supplierAssessmentState,
  supplierNeedsAttention,
  type BoardInput,
  type BoardMessage,
  type Nis2Registration,
  type ObligationRegime,
  type RiskBand,
} from '@toron/core';
import {
  getDashboardMetrics,
  getFrameworkCoverage,
  listActions,
  listEntitiesNis2,
  listIncidents,
  listObligations,
  listProcessing,
  listRisks,
  listSuppliers,
  withTenant,
  type ActionSummary,
  type RiskSummary,
} from '@toron/db';

import { appDb } from '@/lib/db';
import type { OrganisationOverview } from '@/lib/organisation-overview';

const BAND_RANK: Record<RiskBand, number> = { critique: 0, eleve: 1, moyen: 2, faible: 3 };
const PRIORITY_RANK: Record<string, number> = { p1: 0, p2: 1, p3: 2 };

export interface BoardReport {
  messages: BoardMessage[];
  decisions: string[];
  input: BoardInput;
  frameworks: { name: string; scorePct: number | null; gaps: number }[];
  topRisks: RiskSummary[] | null;
  overdueActions: ActionSummary[];
  entities: { name: string; status: ReturnType<typeof nis2Qualification>['status']; reason: string; registration: Nis2Registration }[];
  obligationsByRegime: { regime: ObligationRegime; met: number; applicable: number }[];
}

/** Indicateurs du rapport de direction, en respectant les modules masqués. */
export async function buildBoardReport(tenantId: string, overview: OrganisationOverview, today: string): Promise<BoardReport> {
  const on = overview.enabled;
  const d = await withTenant(appDb().db, tenantId, async (tx) => ({
    metrics: await getDashboardMetrics(tx),
    coverage: await getFrameworkCoverage(tx),
    risks: on('risques') ? await listRisks(tx) : null,
    actions: await listActions(tx),
    incidents: on('incidents') ? await listIncidents(tx) : null,
    obligations: await listObligations(tx),
    entities: await listEntitiesNis2(tx),
    suppliers: on('fournisseurs') ? await listSuppliers(tx) : null,
    processing: await listProcessing(tx),
  }));

  const overdue = d.actions.filter((a) => a.effectiveStatus === 'en_retard');
  const applicable = d.obligations.filter((o) => o.status !== 'non_applicable');
  const qualified = d.entities.map((e) => ({ entity: e, q: nis2Qualification({ ...e, override: e.override }) }));
  const withoutAgreement = new Set<string>();
  for (const p of d.processing) for (const x of p.processors) if (processorAgreementState(x, today) !== 'couvert') withoutAgreement.add(x.supplierId);

  const input: BoardInput = {
    coveragePct: d.metrics.coveragePct,
    risks: d.risks && {
      critical: d.risks.filter((r) => r.netBand === 'critique').length,
      high: d.risks.filter((r) => r.netBand === 'eleve').length,
      acceptancePending: d.risks.filter((r) => acceptanceNeedsAttention(r.acceptanceState)).length,
    },
    actions: { open: d.actions.filter((a) => a.status !== 'termine').length, overdue: overdue.length, overdueP1: overdue.filter((a) => a.priority === 'p1').length },
    incidents: d.incidents && {
      open: d.incidents.filter((i) => i.status !== 'clos').length,
      nis2ImportantOpen: d.incidents.filter((i) => i.status !== 'clos' && i.nis2Important).length,
    },
    obligations: {
      applicable: applicable.length,
      met: applicable.filter((o) => o.status === 'conforme').length,
      late: d.obligations.filter((o) => obligationAttention(o.status, o.dueDate, today) === 'en_retard').length,
      unowned: applicable.filter((o) => o.status !== 'conforme' && !o.ownerUserId).length,
      nis2Governance: d.obligations.find((o) => o.catalogKey === 'nis2_gouvernance')?.status ?? null,
    },
    entities: qualified.map(({ entity, q }) => ({ name: entity.name, nis2: q.status, registration: entity.registration })),
    suppliers: d.suppliers && {
      watch: d.suppliers.filter((s) => supplierNeedsAttention(s.tier, {
        assessment: supplierAssessmentState(s.tier, s.lastAssessedOn, today),
        insufficient: s.lastRating === 'insuffisant',
        expiredAttestation: s.attestationCount > 0 && attestationFreshness(s.nextAttestationExpiry, today) === 'expiree',
      })).length,
    },
    processing: { total: d.processing.length, incomplete: d.processing.filter((p) => processingGaps(p).length > 0).length, processorsWithoutAgreement: withoutAgreement.size },
    evidencesStale: d.metrics.evidencesStale,
  };

  return {
    messages: boardMessages(input),
    decisions: boardDecisions(input),
    input,
    frameworks: d.coverage.filter((f) => f.campaign).map((f) => ({ name: f.name, scorePct: f.campaign!.score.scorePct, gaps: f.campaign!.score.gaps })),
    topRisks: d.risks && [...d.risks]
      .filter((r) => r.netBand === 'critique' || r.netBand === 'eleve')
      .sort((a, b) => BAND_RANK[a.netBand!] - BAND_RANK[b.netBand!] || b.netG * b.netV - a.netG * a.netV)
      .slice(0, 5),
    overdueActions: [...overdue].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (a.dueDate ?? '').localeCompare(b.dueDate ?? '')).slice(0, 5),
    entities: qualified.map(({ entity, q }) => ({ name: entity.name, status: q.status, reason: q.reason, registration: entity.registration })),
    obligationsByRegime: OBLIGATION_REGIMES
      .map((regime) => {
        const rows = applicable.filter((o) => o.regime === regime);
        return { regime, met: rows.filter((o) => o.status === 'conforme').length, applicable: rows.length };
      })
      .filter((r) => r.applicable > 0),
  };
}
