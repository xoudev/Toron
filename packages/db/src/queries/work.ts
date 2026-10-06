import { REASSESSMENT_MONTHS, type WorkItem, type WorkKind } from '@toron/core';
import { sql } from 'drizzle-orm';

import type { TenantTx } from '../tenant.ts';

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
    SELECT 'controle', c.id, c.title, NULL, NULL
      FROM controls c WHERE c.owner_user_id = ${userId} AND c.status = 'actif'
    UNION ALL
    SELECT 'processus', p.id, p.name, NULL, NULL
      FROM processes p WHERE p.pilot_user_id = ${userId}
  `)) as unknown as Row[];

  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    title: r.title,
    due: r.due,
    detail: detailFor(r),
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
    case 'controle': return 'Contrôle sous votre responsabilité';
    case 'processus': return 'Processus que vous pilotez';
  }
}
