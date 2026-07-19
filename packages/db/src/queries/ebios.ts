import {
  deriveScenarioLikelihood,
  scenarioRiskRating,
  type EbiosLikelihood,
  type EbiosPhase,
} from '@toron/core';
import { eq, sql } from 'drizzle-orm';

import { createRisk } from './risks.ts';
import * as schema from '../schema/index.ts';
import type { TenantTx } from '../tenant.ts';

// ── Couche d'accès des ateliers EBIOS RM (module 5.4b) ─────────────────
// L'atelier 4 construit la kill chain ; la vraisemblance se dérive de la
// complétude des phases (packages/core). L'atelier 5 génère le risque dans
// le registre UNIQUE (source 'ebios'). RLS active.

export async function createStudy(tx: TenantTx, input: { tenantId: string; title: string; scopeId?: string | null }): Promise<string> {
  const [row] = await tx
    .insert(schema.ebiosStudies)
    .values({ tenantId: input.tenantId, title: input.title, scopeId: input.scopeId ?? null })
    .returning({ id: schema.ebiosStudies.id });
  return row!.id;
}

export async function setWorkshop(tx: TenantTx, studyId: string, workshop: number): Promise<number> {
  const u = await tx
    .update(schema.ebiosStudies)
    .set({ workshop })
    .where(eq(schema.ebiosStudies.id, studyId))
    .returning({ id: schema.ebiosStudies.id });
  return u.length;
}

export async function addScenario(
  tx: TenantTx,
  input: { tenantId: string; studyId: string; riskSource: string; targetObjective: string; kind?: 'strategique' | 'operationnel' },
): Promise<string> {
  const [row] = await tx
    .insert(schema.ebiosScenarios)
    .values({ tenantId: input.tenantId, studyId: input.studyId, riskSource: input.riskSource, targetObjective: input.targetObjective, kind: input.kind ?? 'operationnel' })
    .returning({ id: schema.ebiosScenarios.id });
  return row!.id;
}

/** Ajoute une action élémentaire à une phase, puis recote la vraisemblance. */
export async function addAction(
  tx: TenantTx,
  input: { tenantId: string; scenarioId: string; phase: EbiosPhase; label: string; mitreId?: string | null; mitreName?: string | null },
): Promise<EbiosLikelihood | null> {
  await tx.insert(schema.ebiosActions).values({
    tenantId: input.tenantId,
    scenarioId: input.scenarioId,
    phase: input.phase,
    label: input.label,
    mitreId: input.mitreId ?? null,
    mitreName: input.mitreName ?? null,
  });
  return recomputeLikelihood(tx, input.scenarioId);
}

/** Recalcule la vraisemblance depuis les phases renseignées et l'enregistre. */
export async function recomputeLikelihood(tx: TenantTx, scenarioId: string): Promise<EbiosLikelihood | null> {
  const rows = (await tx.execute(sql`
    SELECT DISTINCT phase FROM ebios_actions WHERE scenario_id = ${scenarioId}
  `)) as unknown as { phase: EbiosPhase }[];
  const likelihood = deriveScenarioLikelihood(rows.map((r) => r.phase));
  await tx.update(schema.ebiosScenarios).set({ likelihood }).where(eq(schema.ebiosScenarios.id, scenarioId));
  return likelihood;
}

/** Génère le risque dans le registre unique (atelier 5, source 'ebios'). */
export async function generateRiskFromScenario(
  tx: TenantTx,
  input: { tenantId: string; scenarioId: string; scopeId: string; ratedBy: string },
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT risk_source, target_objective, likelihood, generated_risk_id
    FROM ebios_scenarios WHERE id = ${input.scenarioId}
  `)) as unknown as { risk_source: string; target_objective: string; likelihood: EbiosLikelihood | null; generated_risk_id: string | null }[];
  const sc = rows[0];
  if (!sc) throw new Error('Scénario introuvable.');
  if (sc.generated_risk_id) return sc.generated_risk_id;
  if (!sc.likelihood) throw new Error('Le scénario doit être coté avant génération.');

  const { g, v } = scenarioRiskRating(sc.likelihood);
  const riskId = await createRisk(tx, {
    tenantId: input.tenantId,
    scopeId: input.scopeId,
    title: `${sc.risk_source} → ${sc.target_objective}`,
    scenario: `Scénario opérationnel EBIOS RM : ${sc.risk_source} cherchant à ${sc.target_objective.toLowerCase()}.`,
    grossG: g,
    grossV: v,
    netG: g,
    netV: v,
    treatment: 'reduire',
    ratedBy: input.ratedBy,
    source: 'ebios',
  });
  await tx.update(schema.ebiosScenarios).set({ generatedRiskId: riskId }).where(eq(schema.ebiosScenarios.id, input.scenarioId));
  return riskId;
}

export interface StudySummary {
  id: string;
  title: string;
  scopeId: string | null;
  scopeName: string | null;
  workshop: number;
  scenarioCount: number;
  ratedCount: number;
}

interface RawStudy {
  id: string;
  title: string;
  scope_id: string | null;
  scope_name: string | null;
  workshop: number | string;
  scenario_count: number | string;
  rated_count: number | string;
}

function toStudySummary(r: RawStudy): StudySummary {
  return {
    id: r.id,
    title: r.title,
    scopeId: r.scope_id,
    scopeName: r.scope_name,
    workshop: Number(r.workshop),
    scenarioCount: Number(r.scenario_count),
    ratedCount: Number(r.rated_count),
  };
}

const STUDY_COLUMNS = sql`
  st.id, st.title, st.scope_id, s.name AS scope_name, st.workshop,
  (SELECT count(*) FROM ebios_scenarios sc WHERE sc.study_id = st.id) AS scenario_count,
  (SELECT count(*) FROM ebios_scenarios sc WHERE sc.study_id = st.id AND sc.likelihood IS NOT NULL) AS rated_count
`;

export async function listStudies(tx: TenantTx): Promise<StudySummary[]> {
  const rows = await tx.execute(sql`
    SELECT ${STUDY_COLUMNS}
    FROM ebios_studies st LEFT JOIN scopes s ON s.id = st.scope_id
    ORDER BY st.created_at DESC
  `);
  return (rows as unknown as RawStudy[]).map(toStudySummary);
}

export interface EbiosActionRow {
  id: string;
  phase: EbiosPhase;
  mitreId: string | null;
  mitreName: string | null;
  label: string;
}
export interface EbiosScenarioRow {
  id: string;
  kind: 'strategique' | 'operationnel';
  riskSource: string;
  targetObjective: string;
  likelihood: EbiosLikelihood | null;
  generatedRiskId: string | null;
  actions: EbiosActionRow[];
}
export interface StudyDetail extends StudySummary {
  scenarios: EbiosScenarioRow[];
}

export async function getStudy(tx: TenantTx, studyId: string): Promise<StudyDetail | null> {
  const headRows = await tx.execute(sql`
    SELECT ${STUDY_COLUMNS}
    FROM ebios_studies st LEFT JOIN scopes s ON s.id = st.scope_id
    WHERE st.id = ${studyId}
  `);
  const heads = headRows as unknown as RawStudy[];
  if (heads.length === 0) return null;

  const scenarioRows = (await tx.execute(sql`
    SELECT id, kind, risk_source, target_objective, likelihood, generated_risk_id
    FROM ebios_scenarios WHERE study_id = ${studyId}
    ORDER BY created_at
  `)) as unknown as { id: string; kind: 'strategique' | 'operationnel'; risk_source: string; target_objective: string; likelihood: EbiosLikelihood | null; generated_risk_id: string | null }[];

  const actionRows = (await tx.execute(sql`
    SELECT a.id, a.scenario_id, a.phase, a.mitre_id, a.mitre_name, a.label
    FROM ebios_actions a
    JOIN ebios_scenarios sc ON sc.id = a.scenario_id
    WHERE sc.study_id = ${studyId}
    ORDER BY a.position, a.created_at
  `)) as unknown as { id: string; scenario_id: string; phase: EbiosPhase; mitre_id: string | null; mitre_name: string | null; label: string }[];

  const byScenario = new Map<string, EbiosActionRow[]>();
  for (const a of actionRows) {
    const list = byScenario.get(a.scenario_id) ?? [];
    list.push({ id: a.id, phase: a.phase, mitreId: a.mitre_id, mitreName: a.mitre_name, label: a.label });
    byScenario.set(a.scenario_id, list);
  }

  return {
    ...toStudySummary(heads[0]!),
    scenarios: scenarioRows.map((s) => ({
      id: s.id,
      kind: s.kind,
      riskSource: s.risk_source,
      targetObjective: s.target_objective,
      likelihood: s.likelihood,
      generatedRiskId: s.generated_risk_id,
      actions: byScenario.get(s.id) ?? [],
    })),
  };
}
