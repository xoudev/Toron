/**
 * Rapport de direction (module 5.11, V1). Règles pures : à partir des
 * indicateurs de l'organisation, choisir les messages clés et les décisions
 * attendues de la direction. Le rapport ne montre que ce qui demande
 * l'attention ou mérite d'être su ; le détail reste dans les modules.
 */

import type { Nis2Registration, Nis2Status, ObligationStatus } from './obligations.ts';

export interface BoardEntity {
  name: string;
  nis2: Nis2Status | 'indeterminee';
  registration: Nis2Registration;
}

export interface BoardInput {
  coveragePct: number | null;
  /** null quand le registre des risques est masqué. */
  risks: { critical: number; high: number; acceptancePending: number } | null;
  actions: { open: number; overdue: number; overdueP1: number };
  /** null quand le module incidents est masqué. */
  incidents: { open: number; nis2ImportantOpen: number } | null;
  obligations: { applicable: number; met: number; late: number; unowned: number; nis2Governance: ObligationStatus | null };
  entities: readonly BoardEntity[];
  /** null quand le module fournisseurs est masqué. */
  suppliers: { watch: number } | null;
  processing: { total: number; incomplete: number; processorsWithoutAgreement: number };
  evidencesStale: number;
}

export type BoardTone = 'alerte' | 'vigilance' | 'positif';

export interface BoardMessage {
  tone: BoardTone;
  text: string;
}

const s = (n: number, word: string, plural = `${word}s`) => `${n} ${n > 1 ? plural : word}`;

const TONE_ORDER: Record<BoardTone, number> = { alerte: 0, vigilance: 1, positif: 2 };

/** Messages clés, des alertes aux points positifs ; sept au plus. */
export function boardMessages(i: BoardInput): BoardMessage[] {
  const out: BoardMessage[] = [];
  if (i.risks && i.risks.critical > 0) out.push({ tone: 'alerte', text: `${s(i.risks.critical, 'risque critique', 'risques critiques')} après traitement.` });
  if (i.actions.overdueP1 > 0) out.push({ tone: 'alerte', text: `${s(i.actions.overdueP1, 'action prioritaire', 'actions prioritaires')} en retard.` });
  if (i.incidents && i.incidents.nis2ImportantOpen > 0) out.push({ tone: 'alerte', text: `${s(i.incidents.nis2ImportantOpen, 'incident important NIS 2', 'incidents importants NIS 2')} en cours de traitement.` });
  for (const e of i.entities) {
    if ((e.nis2 === 'ee' || e.nis2 === 'ei') && e.registration === 'a_faire') out.push({ tone: 'alerte', text: `${e.name} : enregistrement auprès de l’ANSSI non engagé.` });
  }
  if (i.obligations.late > 0) out.push({ tone: 'vigilance', text: `${s(i.obligations.late, 'obligation réglementaire', 'obligations réglementaires')} dont l’échéance est dépassée.` });
  const otherOverdue = i.actions.overdue - i.actions.overdueP1;
  if (otherOverdue > 0) out.push({ tone: 'vigilance', text: `${s(otherOverdue, 'autre action', 'autres actions')} en retard.` });
  if (i.suppliers && i.suppliers.watch > 0) out.push({ tone: 'vigilance', text: `${s(i.suppliers.watch, 'fournisseur', 'fournisseurs')} à suivre : évaluation insuffisante ou à refaire, ou attestation expirée.` });
  if (i.processing.incomplete > 0 || i.processing.processorsWithoutAgreement > 0) {
    const parts = [
      i.processing.incomplete > 0 ? s(i.processing.incomplete, 'fiche de traitement incomplète', 'fiches de traitement incomplètes') : null,
      i.processing.processorsWithoutAgreement > 0 ? s(i.processing.processorsWithoutAgreement, 'sous-traitant sans accord de traitement', 'sous-traitants sans accord de traitement') : null,
    ].filter(Boolean);
    out.push({ tone: 'vigilance', text: `RGPD : ${parts.join(', ')}.` });
  }
  if (i.evidencesStale > 0) out.push({ tone: 'vigilance', text: `${s(i.evidencesStale, 'preuve expirée ou bientôt expirée', 'preuves expirées ou bientôt expirées')}.` });
  if (i.coveragePct !== null && i.coveragePct >= 80) out.push({ tone: 'positif', text: `Couverture de ${i.coveragePct} % des exigences évaluées.` });
  if (i.obligations.applicable > 0 && i.obligations.met / i.obligations.applicable >= 0.8) out.push({ tone: 'positif', text: `${i.obligations.met} obligations respectées sur ${i.obligations.applicable}.` });
  if (i.risks && i.risks.critical === 0 && i.risks.high === 0) out.push({ tone: 'positif', text: 'Aucun risque élevé ou critique après traitement.' });
  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]).slice(0, 7);
}

/** Décisions qui relèvent de la direction, formulées comme des demandes. */
export function boardDecisions(i: BoardInput): string[] {
  const out: string[] = [];
  if (i.risks && i.risks.acceptancePending > 0) {
    out.push(`Accepter formellement ou refuser ${s(i.risks.acceptancePending, 'risque', 'risques')} dont le traitement retenu est l’acceptation.`);
  }
  const concerned = i.entities.some((e) => e.nis2 === 'ee' || e.nis2 === 'ei');
  if (concerned && i.obligations.nis2Governance !== null && i.obligations.nis2Governance !== 'conforme') {
    out.push('Approuver les mesures de cybersécurité et planifier la formation des dirigeants (NIS 2, art. 20).');
  }
  if (i.actions.overdueP1 > 0) {
    out.push(i.actions.overdueP1 === 1
      ? 'Arbitrer les moyens de l’action prioritaire en retard.'
      : `Arbitrer les moyens des ${i.actions.overdueP1} actions prioritaires en retard.`);
  }
  if (i.obligations.unowned > 0) out.push(`Désigner un responsable pour ${s(i.obligations.unowned, 'obligation', 'obligations')}.`);
  if (i.suppliers && i.suppliers.watch > 0) out.push(`Statuer sur ${s(i.suppliers.watch, 'fournisseur', 'fournisseurs')} à suivre : maintien, plan d’amélioration ou remplacement.`);
  return out;
}
