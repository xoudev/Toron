import { describe, expect, it } from 'vitest';

import { boardDecisions, boardMessages, type BoardInput } from './board.ts';

const calm: BoardInput = {
  coveragePct: 86,
  risks: { critical: 0, high: 0, acceptancePending: 0, unplanned: 0, unplannedSevere: 0 },
  actions: { open: 12, overdue: 0, overdueP1: 0 },
  incidents: { open: 0, nis2ImportantOpen: 0 },
  obligations: { applicable: 10, met: 9, late: 0, unowned: 0, nis2Governance: 'conforme' },
  entities: [{ name: 'Meridiane Logistics SAS', nis2: 'ei', registration: 'enregistree' }],
  suppliers: { watch: 0 },
  processing: { total: 5, incomplete: 0, processorsWithoutAgreement: 0 },
  evidencesStale: 0,
};

describe('messages clés du rapport de direction', () => {
  it('une organisation sans point ouvert ne reçoit que des messages positifs', () => {
    expect(boardMessages(calm).map((m) => m.tone)).toEqual(['positif', 'positif', 'positif']);
  });

  it('classe les alertes avant la vigilance et accorde singulier et pluriel', () => {
    const messages = boardMessages({
      ...calm,
      risks: { critical: 1, high: 2, acceptancePending: 0, unplanned: 0, unplannedSevere: 0 },
      actions: { open: 12, overdue: 3, overdueP1: 2 },
      obligations: { ...calm.obligations, late: 1 },
    });
    expect(messages.slice(0, 4)).toEqual([
      { tone: 'alerte', text: '1 risque critique après traitement.' },
      { tone: 'alerte', text: '2 actions prioritaires en retard.' },
      { tone: 'vigilance', text: '1 obligation réglementaire dont l’échéance est dépassée.' },
      { tone: 'vigilance', text: '1 autre action en retard.' },
    ]);
  });

  it('alerte sur une entité concernée par NIS 2 qui n’a pas engagé son enregistrement', () => {
    const messages = boardMessages({ ...calm, entities: [{ name: 'Filiale Sud', nis2: 'ee', registration: 'a_faire' }] });
    expect(messages[0]).toEqual({ tone: 'alerte', text: 'Filiale Sud : enregistrement auprès de l’ANSSI non engagé.' });
    expect(boardMessages({ ...calm, entities: [{ name: 'Filiale Sud', nis2: 'non_concernee', registration: 'a_faire' }] }).some((m) => m.tone === 'alerte')).toBe(false);
  });

  it('ignore les modules masqués et limite le rapport à sept messages', () => {
    const busy: BoardInput = {
      ...calm,
      risks: null,
      incidents: null,
      suppliers: null,
      actions: { open: 30, overdue: 9, overdueP1: 4 },
      obligations: { ...calm.obligations, late: 2 },
      entities: [
        { name: 'A', nis2: 'ee', registration: 'a_faire' },
        { name: 'B', nis2: 'ei', registration: 'a_faire' },
        { name: 'C', nis2: 'ei', registration: 'a_faire' },
      ],
      processing: { total: 5, incomplete: 2, processorsWithoutAgreement: 1 },
      evidencesStale: 3,
    };
    const messages = boardMessages(busy);
    expect(messages).toHaveLength(7);
    expect(messages.some((m) => m.text.includes('risque'))).toBe(false);
    expect(messages.filter((m) => m.tone === 'alerte')).toHaveLength(4);
    // Le huitième message (preuves) est écarté, les alertes restent en tête.
    expect(messages.some((m) => m.text.includes('preuve'))).toBe(false);
  });
});

describe('risques sans plan de traitement', () => {
  it('signale les décisions de traitement restées sans action', () => {
    const messages = boardMessages({ ...calm, risks: { ...calm.risks!, unplanned: 2, unplannedSevere: 0 } });
    expect(messages).toContainEqual({ tone: 'vigilance', text: '2 risques dont le traitement décidé n’a encore aucune action.' });
    expect(boardDecisions({ ...calm, risks: { ...calm.risks!, unplanned: 2, unplannedSevere: 0 } })).toEqual([]);
  });

  it('demande à la direction de valider un plan pour un risque élevé non traité', () => {
    expect(boardDecisions({ ...calm, risks: { critical: 0, high: 1, acceptancePending: 0, unplanned: 1, unplannedSevere: 1 } })).toEqual([
      'Valider un plan de traitement pour 1 risque élevé ou critique sans action engagée.',
    ]);
  });
});

describe('décisions attendues de la direction', () => {
  it('rien à décider quand tout est en ordre', () => {
    expect(boardDecisions(calm)).toEqual([]);
  });

  it('formule les arbitrages qui relèvent de la direction', () => {
    expect(boardDecisions({
      ...calm,
      risks: { critical: 0, high: 1, acceptancePending: 2, unplanned: 0, unplannedSevere: 0 },
      actions: { open: 5, overdue: 1, overdueP1: 1 },
      obligations: { ...calm.obligations, unowned: 3, nis2Governance: 'en_cours' },
      suppliers: { watch: 1 },
    })).toEqual([
      'Accepter formellement ou refuser 2 risques dont le traitement retenu est l’acceptation.',
      'Approuver les mesures de cybersécurité et planifier la formation des dirigeants (NIS 2, art. 20).',
      'Arbitrer les moyens de l’action prioritaire en retard.',
      'Désigner un responsable pour 3 obligations.',
      'Statuer sur 1 fournisseur à suivre : maintien, plan d’amélioration ou remplacement.',
    ]);
  });

  it('ne demande pas l’approbation NIS 2 à une organisation non concernée', () => {
    expect(boardDecisions({ ...calm, entities: [{ name: 'X', nis2: 'non_concernee', registration: 'sans_objet' }], obligations: { ...calm.obligations, nis2Governance: 'a_evaluer' } })).toEqual([]);
  });
});
