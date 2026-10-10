import { describe, expect, it } from 'vitest';

import { boardDecisions, boardMessages, type BoardInput } from './board.ts';

const calm: BoardInput = {
  coveragePct: 86,
  risks: { total: 12, critical: 0, high: 0, acceptancePending: 0, unplanned: 0, unplannedSevere: 0 },
  actions: { open: 12, overdue: 0, overdueP1: 0 },
  incidents: { open: 0, nis2ImportantOpen: 0 },
  obligations: { applicable: 10, met: 9, late: 0, unowned: 0, nis2Governance: 'conforme' },
  entities: [{ name: 'Meridiane Logistics SAS', nis2: 'ei', registration: 'enregistree' }],
  suppliers: { watch: 0 },
  processing: { total: 5, incomplete: 0, processorsWithoutAgreement: 0 },
  evidencesStale: 0,
  exceptions: { pending: 0, lapsed: 0 },
  controls: { active: 3, late: 0, ineffective: 0 },
  training: { held: 3, withoutSheet: 0, leaders: 1, leadersUntrained: 0, leadersDueSoon: 0 },
  continuity: { activities: 4, criticalUntested: 0, objectiveMissed: 0, biaDue: 0 },
  satisfaction: { surveys: 3, belowTarget: 0, complaints: 2, complaintsPrevious: 4 },
};

describe('messages clés du rapport de direction', () => {
  it('une organisation sans point ouvert ne reçoit que des messages positifs', () => {
    expect(boardMessages(calm).map((m) => m.tone)).toEqual(['positif', 'positif', 'positif', 'positif', 'positif', 'positif', 'positif']);
  });

  it('classe les alertes avant la vigilance et accorde singulier et pluriel', () => {
    const messages = boardMessages({
      ...calm,
      risks: { total: 12, critical: 1, high: 2, acceptancePending: 0, unplanned: 0, unplannedSevere: 0 },
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

describe('registre des risques vide', () => {
  it('ne félicite pas une organisation sans risque enregistré et signale l’analyse à conduire', () => {
    const messages = boardMessages({ ...calm, risks: { ...calm.risks!, total: 0 } });
    expect(messages.some((m) => m.text.startsWith('Aucun risque élevé'))).toBe(false);
    expect(messages).toContainEqual({ tone: 'vigilance', text: 'Registre des risques vide : aucune analyse de risques n’a encore été conduite.' });
    expect(boardMessages(calm)).toContainEqual({ tone: 'positif', text: 'Aucun risque élevé ou critique après traitement.' });
  });

  it('se tait quand le registre est masqué', () => {
    expect(boardMessages({ ...calm, risks: null }).some((m) => /risque/.test(m.text))).toBe(false);
  });

  it('rapporte la couverture aux exigences applicables, « à évaluer » comprises', () => {
    expect(boardMessages(calm)).toContainEqual({ tone: 'positif', text: 'Couverture de 86 % des exigences applicables.' });
  });
});

describe('risques sans plan de traitement', () => {
  it('signale les décisions de traitement restées sans action', () => {
    const messages = boardMessages({ ...calm, risks: { ...calm.risks!, unplanned: 2, unplannedSevere: 0 } });
    expect(messages).toContainEqual({ tone: 'vigilance', text: '2 risques dont le traitement décidé n’a encore aucune action.' });
    expect(boardDecisions({ ...calm, risks: { ...calm.risks!, unplanned: 2, unplannedSevere: 0 } })).toEqual([]);
  });

  it('demande à la direction de valider un plan pour un risque élevé non traité', () => {
    expect(boardDecisions({ ...calm, risks: { total: 12, critical: 0, high: 1, acceptancePending: 0, unplanned: 1, unplannedSevere: 1 } })).toEqual([
      'Valider un plan de traitement pour 1 risque élevé ou critique sans action engagée.',
    ]);
  });
});

describe('contrôles internes', () => {
  it('alerte sur un contrôle inefficace, signale les revues en retard et demande d’arbitrer', () => {
    const input = { ...calm, controls: { active: 3, late: 2, ineffective: 1 } };
    const messages = boardMessages(input);
    expect(messages[0]).toEqual({ tone: 'alerte', text: '1 contrôle jugé inefficace à la dernière revue.' });
    expect(messages).toContainEqual({ tone: 'vigilance', text: '2 contrôles en retard de revue : efficacité non démontrée.' });
    expect(messages.some((m) => m.text.startsWith('Tous les contrôles'))).toBe(false);
    expect(boardDecisions(input)).toEqual(['Arbitrer les moyens pour rétablir le contrôle jugé inefficace.']);
  });

  it('ne félicite pas une organisation sans contrôle', () => {
    expect(boardMessages({ ...calm, controls: { active: 0, late: 0, ineffective: 0 } }).some((m) => m.text.startsWith('Tous les contrôles'))).toBe(false);
  });
});

describe('dérogations', () => {
  it('alerte sur une dérogation échue sans clôture et demande de trancher les demandes', () => {
    const input = { ...calm, exceptions: { pending: 2, lapsed: 1 } };
    expect(boardMessages(input)[0]).toEqual({ tone: 'alerte', text: '1 dérogation échue sans clôture : l’écart n’est plus couvert.' });
    expect(boardDecisions(input)).toEqual(['Accorder ou refuser 2 demandes de dérogation.']);
  });

  it('se tait quand le module est masqué', () => {
    const input = { ...calm, exceptions: null };
    expect(boardMessages(input).some((m) => m.text.includes('dérogation'))).toBe(false);
    expect(boardDecisions(input)).toEqual([]);
  });
});

describe('sensibilisation et formation des dirigeants', () => {
  it('alerte sur un dirigeant sans formation à jour et demande de la planifier', () => {
    const input = { ...calm, training: { ...calm.training!, leadersUntrained: 1 } };
    expect(boardMessages(input)[0]).toEqual({ tone: 'alerte', text: '1 dirigeant sans formation à la cybersécurité à jour (NIS 2, art. 20).' });
    expect(boardMessages(input).some((m) => m.text.startsWith('Formation à la cybersécurité des dirigeants'))).toBe(false);
    expect(boardDecisions(input)).toEqual(['Planifier la formation à la cybersécurité de 1 dirigeant (NIS 2, art. 20).']);
  });

  it('signale l’absence de session, les feuilles d’émargement manquantes et les renouvellements proches', () => {
    const messages = boardMessages({ ...calm, training: { held: 0, withoutSheet: 0, leaders: 2, leadersUntrained: 0, leadersDueSoon: 2 } });
    expect(messages).toContainEqual({ tone: 'vigilance', text: 'Aucune session de sensibilisation tenue sur douze mois.' });
    expect(messages).toContainEqual({ tone: 'vigilance', text: 'Formation à la cybersécurité à renouveler d’ici deux mois pour 2 dirigeants.' });
    expect(boardMessages({ ...calm, training: { ...calm.training!, withoutSheet: 2 } })).toContainEqual({
      tone: 'vigilance', text: '2 sessions de sensibilisation sans feuille d’émargement au coffre de preuves.',
    });
  });

  it('hors NIS 2, la formation des dirigeants reste un point de vigilance', () => {
    const input = {
      ...calm,
      entities: [{ name: 'X', nis2: 'non_concernee' as const, registration: 'sans_objet' as const }],
      training: { ...calm.training!, leadersUntrained: 2 },
    };
    expect(boardMessages(input)).toContainEqual({ tone: 'vigilance', text: '2 dirigeants sans formation à la cybersécurité à jour.' });
    expect(boardDecisions(input)).toEqual(['Planifier la formation à la cybersécurité de 2 dirigeants.']);
  });

  it('module masqué : rien sur la sensibilisation, la décision NIS 2 garde la formation des dirigeants', () => {
    const input = { ...calm, training: null, obligations: { ...calm.obligations, nis2Governance: 'en_cours' as const } };
    expect(boardMessages(input).some((m) => /sensibilisation|formation/.test(m.text))).toBe(false);
    expect(boardDecisions(input)).toEqual(['Approuver les mesures de cybersécurité et planifier la formation des dirigeants (NIS 2, art. 20).']);
  });
});

describe('continuité d’activité', () => {
  it('alerte sur un objectif de reprise manqué et demande d’arbitrer les moyens', () => {
    const input = { ...calm, continuity: { activities: 4, criticalUntested: 0, objectiveMissed: 1, biaDue: 0 } };
    expect(boardMessages(input)[0]).toEqual({ tone: 'alerte', text: '1 activité critique n’a pas tenu son objectif de reprise au dernier exercice.' });
    expect(boardDecisions(input)).toEqual(['Arbitrer les moyens pour tenir l’objectif de reprise manqué au dernier exercice.']);
  });

  it('signale les activités fortes ou vitales jamais testées et les bilans d’impact anciens', () => {
    const messages = boardMessages({ ...calm, continuity: { activities: 4, criticalUntested: 2, objectiveMissed: 0, biaDue: 1 } });
    expect(messages).toContainEqual({ tone: 'vigilance', text: '2 activités fortes ou vitales sans exercice de continuité depuis un an.' });
    expect(messages).toContainEqual({ tone: 'vigilance', text: '1 bilan d’impact de plus d’un an, à revoir.' });
    expect(messages.some((m) => m.text.startsWith('Activités critiques testées'))).toBe(false);
  });

  it('se tait quand le module est masqué', () => {
    const input = { ...calm, continuity: null };
    expect(boardMessages(input).some((m) => /reprise|bilan d’impact|continuité/.test(m.text))).toBe(false);
    expect(boardDecisions(input)).toEqual([]);
  });
});

describe('satisfaction client', () => {
  it('signale les enquêtes sous l’objectif et la hausse des réclamations', () => {
    const messages = boardMessages({ ...calm, satisfaction: { surveys: 3, belowTarget: 2, complaints: 5, complaintsPrevious: 2 } });
    expect(messages).toContainEqual({ tone: 'vigilance', text: '2 enquêtes de satisfaction sous l’objectif sur douze mois.' });
    expect(messages).toContainEqual({ tone: 'vigilance', text: 'Réclamations clients en hausse : 5 sur douze mois, contre 2 l’année précédente.' });
    expect(messages.some((m) => m.text.startsWith('Objectifs de satisfaction'))).toBe(false);
  });

  it('demande une mesure quand il n’y en a aucune, et se tait quand le module est masqué', () => {
    expect(boardMessages({ ...calm, satisfaction: { surveys: 0, belowTarget: 0, complaints: 0, complaintsPrevious: 0 } }))
      .toContainEqual({ tone: 'vigilance', text: 'Aucune mesure de satisfaction client sur douze mois.' });
    expect(boardMessages({ ...calm, satisfaction: null }).some((m) => /satisfaction|réclamations/i.test(m.text))).toBe(false);
  });
});

describe('décisions attendues de la direction', () => {
  it('rien à décider quand tout est en ordre', () => {
    expect(boardDecisions(calm)).toEqual([]);
  });

  it('formule les arbitrages qui relèvent de la direction', () => {
    expect(boardDecisions({
      ...calm,
      risks: { total: 12, critical: 0, high: 1, acceptancePending: 2, unplanned: 0, unplannedSevere: 0 },
      actions: { open: 5, overdue: 1, overdueP1: 1 },
      obligations: { ...calm.obligations, unowned: 3, nis2Governance: 'en_cours' },
      suppliers: { watch: 1 },
    })).toEqual([
      'Accepter formellement ou refuser 2 risques dont le traitement retenu est l’acceptation.',
      'Approuver les mesures de gestion des risques de cybersécurité (NIS 2, art. 20).',
      'Arbitrer les moyens de l’action prioritaire en retard.',
      'Désigner un responsable pour 3 obligations.',
      'Statuer sur 1 fournisseur à suivre : maintien, plan d’amélioration ou remplacement.',
    ]);
  });

  it('ne demande pas l’approbation NIS 2 à une organisation non concernée', () => {
    expect(boardDecisions({ ...calm, entities: [{ name: 'X', nis2: 'non_concernee', registration: 'sans_objet' }], obligations: { ...calm.obligations, nis2Governance: 'a_evaluer' } })).toEqual([]);
  });
});
