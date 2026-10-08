import {
  BIA_REVIEW_MONTHS,
  EXCEPTION_DECIDER_ROLES,
  LEADER_ROLES,
  LEADER_TRAINING_MONTHS,
  PROCESSING_REVIEW_MONTHS,
  REASSESSMENT_MONTHS,
  REVIEW_FREQUENCY_MONTHS,
  type TreatmentPlanState,
  type WorkItem,
  type WorkKind,
} from '@toron/core';
import { sql } from 'drizzle-orm';

import type { TenantTx } from '../tenant.ts';
import { listRisks } from './risks.ts';

// ── « Mon travail » : éléments assignés à un membre dans tous les modules ──
// Lecture seule, dans le contexte RLS de l'organisation courante : la
// politique de chaque table borne déjà le résultat à l'organisation.

const NOTIF_LABEL: Record<string, string> = {
  alerte_24h: 'Alerte précoce 24 h',
  notification_72h: 'Notification 72 h',
  rapport_30j: 'Rapport final J+30',
  cnil_72h: 'Notification CNIL 72 h',
};

const ACTION_STATUS_LABEL: Record<string, string> = {
  planifie: 'Action planifiée',
  en_cours: 'Action en cours',
  verification: 'Vérification d’efficacité',
};

/** Ce que le propriétaire d'un risque doit faire, selon l'état de son plan de traitement. */
const RISK_PLAN_LABEL: Partial<Record<TreatmentPlanState, string>> = {
  non_planifie: 'Traitement à planifier',
  a_recoter: 'Risque à recoter après traitement',
  en_retard: 'Plan de traitement en retard',
};

const NC_STATUS_LABEL: Record<string, string> = {
  ouverte: 'Analyse des causes à mener',
  en_traitement: 'Actions correctives en cours',
  rouverte: 'Non-conformité rouverte',
  cloturee_a_verifier: 'Vérification d’efficacité à réaliser',
};

interface Row {
  kind: WorkKind;
  id: string;
  title: string;
  due: string | null;
  detail: string | null;
}

export async function listMyWork(tx: TenantTx, userId: string): Promise<WorkItem[]> {
  const frequencyMonths = sql.join(
    Object.entries(REVIEW_FREQUENCY_MONTHS).map(([frequency, months]) => sql`WHEN ${frequency} THEN ${months}::int`),
    sql` `,
  );
  const rows = (await tx.execute(sql`
    SELECT 'action' AS kind, a.id, a.title, a.due_date::text AS due, a.status::text AS detail
      FROM actions a WHERE a.owner_user_id = ${userId} AND a.status <> 'termine'
    UNION ALL
    SELECT 'incident', i.id, i.title,
           (SELECT min(n.due_at)::date::text FROM incident_notifications n WHERE n.incident_id = i.id AND n.sent_at IS NULL),
           (SELECT n.kind::text FROM incident_notifications n WHERE n.incident_id = i.id AND n.sent_at IS NULL ORDER BY n.due_at LIMIT 1)
      FROM incidents i WHERE i.owner_user_id = ${userId} AND i.status <> 'clos'
    UNION ALL
    SELECT 'nc', n.id, n.title,
           CASE WHEN n.status = 'cloturee_a_verifier' THEN n.effectiveness_check_at::text END,
           n.status::text
      FROM nonconformities n WHERE n.owner_user_id = ${userId} AND n.status <> 'efficace'
    UNION ALL
    SELECT 'lecture', d.id, d.title, (pv.published_at::date + 30)::text, pv.semver
      FROM documents d
      JOIN LATERAL (
        SELECT v.id, v.semver, v.published_at FROM document_versions v
        WHERE v.document_id = d.id AND v.status = 'publie'
        ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC LIMIT 1
      ) pv ON true
      WHERE d.acknowledgement_required
        AND NOT EXISTS (SELECT 1 FROM document_acknowledgements a WHERE a.version_id = pv.id AND a.user_id = ${userId})
    UNION ALL
    SELECT 'risque', r.id, r.title, r.next_review::text, NULL
      FROM risks r WHERE r.owner_user_id = ${userId}
    UNION ALL
    SELECT 'preuve', e.id, e.title, e.valid_until::text, NULL
      FROM evidences e WHERE e.collector_user_id = ${userId} AND e.superseded_by IS NULL
    UNION ALL
    SELECT 'document', d.id, d.title, d.review_due::text, NULL
      FROM documents d WHERE d.owner_user_id = ${userId}
    UNION ALL
    SELECT 'audit', au.id, au.title, au.planned_at::text, au.status::text
      FROM audits au WHERE au.lead_auditor = ${userId} AND au.status <> 'clos'
    UNION ALL
    SELECT 'fournisseur', s.id, s.name, d.due::text, d.reason
      FROM suppliers s
      LEFT JOIN LATERAL (
        SELECT v.due, v.reason FROM (VALUES
          (s.next_review, 'revue'),
          ((SELECT min(t.valid_until) FROM supplier_attestations t WHERE t.supplier_id = s.id), 'attestation'),
          ((SELECT (max(sa.assessed_on) + make_interval(months => CASE s.tier
                      WHEN 't1' THEN ${REASSESSMENT_MONTHS.t1}::int
                      WHEN 't2' THEN ${REASSESSMENT_MONTHS.t2}::int
                      ELSE ${REASSESSMENT_MONTHS.t3}::int END))::date
              FROM supplier_assessments sa WHERE sa.supplier_id = s.id), 'evaluation')
        ) AS v(due, reason)
        WHERE v.due IS NOT NULL ORDER BY v.due LIMIT 1
      ) d ON true
      WHERE s.owner_user_id = ${userId}
    UNION ALL
    SELECT 'obligation', o.id, o.title, o.due_date::text, o.status
      FROM obligations o WHERE o.owner_user_id = ${userId} AND o.status IN ('a_evaluer', 'en_cours')
    UNION ALL
    SELECT 'traitement', p.id, p.name,
           (p.last_reviewed_on + make_interval(months => ${PROCESSING_REVIEW_MONTHS}::int))::date::text, NULL
      FROM processing_activities p WHERE p.owner_user_id = ${userId}
    UNION ALL
    -- Prochaine revue d'efficacité : une période après la dernière revue, ou
    -- après la création pour un contrôle jamais revu.
    SELECT 'controle', c.id, c.title,
           CASE WHEN c.review_frequency IS NULL THEN NULL ELSE
             (coalesce((SELECT max(x.reviewed_on) FROM control_reviews x WHERE x.control_id = c.id), c.created_at::date)
              + make_interval(months => CASE c.review_frequency::text ${frequencyMonths} END))::date::text END,
           CASE WHEN EXISTS (SELECT 1 FROM control_reviews x WHERE x.control_id = c.id) THEN 'revue' ELSE 'premiere' END
      FROM controls c WHERE c.owner_user_id = ${userId} AND c.status = 'actif'
    UNION ALL
    SELECT 'processus', p.id, p.name, NULL, NULL
      FROM processes p WHERE p.pilot_user_id = ${userId}
    UNION ALL
    -- Dérogations accordées dont on répond : à renouveler ou clôturer à l'échéance,
    -- sauf si un renouvellement est déjà demandé ou accordé.
    SELECT 'derogation', e.id, e.title, e.expires_on::text, 'echeance'
      FROM policy_exceptions e
      WHERE e.owner_user_id = ${userId} AND e.status = 'approuvee'
        AND NOT EXISTS (SELECT 1 FROM policy_exceptions n
                        WHERE n.renewed_from_id = e.id AND n.status IN ('demandee', 'approuvee'))
    UNION ALL
    -- Demandes à trancher par un décideur, hors celles qu'il a faites ou dont il répond.
    SELECT 'derogation', e.id, e.title, e.starts_on::text, 'decision'
      FROM policy_exceptions e
      WHERE e.status = 'demandee' AND e.requested_by <> ${userId} AND e.owner_user_id <> ${userId}
        AND EXISTS (SELECT 1 FROM memberships m
                    WHERE m.user_id = ${userId} AND m.role::text IN (${sql.join(EXCEPTION_DECIDER_ROLES.map((r) => sql`${r}`), sql`, `)}))
    UNION ALL
    -- Formation cybersécurité d'un dirigeant (NIS 2, art. 20) : à renouveler
    -- un an après la dernière session « dirigeants » suivie, sans échéance
    -- s'il n'en a suivi aucune.
    SELECT 'formation', m.user_id, 'Formation des dirigeants à la cybersécurité (NIS 2)',
           (SELECT (max(s.held_on) + make_interval(months => ${LEADER_TRAINING_MONTHS}::int))::date::text
              FROM training_attendees a JOIN training_sessions s ON s.id = a.session_id
             WHERE a.user_id = m.user_id AND s.kind = 'formation_dirigeants' AND s.held_on <= CURRENT_DATE),
           NULL
      FROM memberships m
      WHERE m.user_id = ${userId} AND m.role::text IN (${sql.join(LEADER_ROLES.map((r) => sql`${r}`), sql`, `)})
    UNION ALL
    -- Bilan d'impact d'une activité dont on répond : à revoir un an après.
    SELECT 'continuite', a.id, a.name, (a.assessed_on + make_interval(months => ${BIA_REVIEW_MONTHS}::int))::date::text, 'bia'
      FROM continuity_activities a WHERE a.owner_user_id = ${userId}
    UNION ALL
    -- Exercice planifié que l'on pilote.
    SELECT 'continuite', e.id, e.title, e.scheduled_on::text, 'exercice'
      FROM continuity_exercises e WHERE e.lead_user_id = ${userId} AND e.status = 'planifie'
  `)) as unknown as Row[];

  // L'état du plan dépend de l'échelle active : calculé par le cœur, pas en SQL.
  const plans = rows.some((r) => r.kind === 'risque')
    ? new Map((await listRisks(tx)).map((r) => [r.id, r.treatmentPlan]))
    : new Map<string, TreatmentPlanState>();

  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    title: r.title,
    due: r.due,
    detail: r.kind === 'risque' ? RISK_PLAN_LABEL[plans.get(r.id) ?? 'en_cours'] ?? 'Revue du risque' : detailFor(r),
  }));
}

function detailFor(r: Row): string {
  switch (r.kind) {
    case 'action': return ACTION_STATUS_LABEL[r.detail ?? ''] ?? 'Action à réaliser';
    case 'incident': return r.detail ? `${NOTIF_LABEL[r.detail] ?? 'Notification'} à transmettre` : 'Incident à clôturer';
    case 'nc': return NC_STATUS_LABEL[r.detail ?? ''] ?? 'Non-conformité à traiter';
    case 'lecture': return `Lire et accepter la version ${r.detail ?? ''}`.trim();
    case 'risque': return 'Revue du risque';
    case 'preuve': return 'Renouvellement de la preuve';
    case 'document': return 'Revue documentaire';
    case 'audit': return r.detail === 'en_cours' ? 'Audit en cours' : 'Audit à conduire';
    case 'fournisseur': return r.detail === 'attestation' ? 'Attestation à renouveler' : r.detail === 'evaluation' ? 'Évaluation à refaire' : 'Revue du fournisseur';
    case 'obligation': return r.detail === 'a_evaluer' ? 'Obligation à évaluer' : 'Obligation en cours de mise en conformité';
    case 'traitement': return r.due ? 'Révision annuelle de la fiche' : 'Fiche de traitement à relire';
    case 'controle': return r.due === null ? 'Contrôle sous votre responsabilité' : r.detail === 'premiere' ? 'Première revue d’efficacité à réaliser' : 'Revue d’efficacité à réaliser';
    case 'processus': return 'Processus que vous pilotez';
    case 'derogation': return r.detail === 'decision' ? 'Demande de dérogation à trancher' : 'Dérogation à renouveler ou clôturer à l’échéance';
    case 'formation': return r.due ? 'Renouvellement de votre formation' : 'Aucune formation enregistrée : à suivre';
    case 'continuite': return r.detail === 'exercice' ? 'Exercice de continuité à conduire' : 'Bilan d’impact à revoir';
  }
}
