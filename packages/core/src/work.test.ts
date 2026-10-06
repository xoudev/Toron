import { describe, expect, it } from 'vitest';

import { dueLabel, groupWork, urgentWorkCount, workUrgency, type WorkItem } from './work.ts';

const today = '2026-10-06';
const item = (over: Partial<WorkItem>): WorkItem => ({ kind: 'action', id: 'x', title: 'T', due: null, detail: '', ...over });

describe('classement de « Mon travail »', () => {
  it('classe par urgence à partir de la date du jour', () => {
    expect(workUrgency('2026-10-05', today)).toBe('en_retard');
    expect(workUrgency('2026-10-06', today)).toBe('cette_semaine');
    expect(workUrgency('2026-10-13', today)).toBe('cette_semaine');
    expect(workUrgency('2026-10-14', today)).toBe('ce_mois');
    expect(workUrgency('2026-11-05', today)).toBe('ce_mois');
    expect(workUrgency('2026-11-06', today)).toBe('plus_tard');
    expect(workUrgency(null, today)).toBe('sans_echeance');
  });
  it('formule l’échéance en langage courant, y compris à travers un changement d’heure', () => {
    expect(dueLabel('2026-10-01', today)).toBe('En retard de 5 jours');
    expect(dueLabel('2026-10-05', today)).toBe('En retard d’un jour');
    expect(dueLabel(today, today)).toBe('Aujourd’hui');
    expect(dueLabel('2026-10-07', today)).toBe('Demain');
    expect(dueLabel('2026-10-30', '2026-10-20')).toBe('Dans 10 jours');
    expect(dueLabel(null, today)).toBe('Sans échéance');
  });
  it('regroupe sans groupe vide et trie par échéance puis par module', () => {
    const groups = groupWork([
      item({ id: 'a', due: '2026-10-10', kind: 'risque' }),
      item({ id: 'b', due: '2026-10-01' }),
      item({ id: 'c', due: '2026-10-10', kind: 'action' }),
      item({ id: 'd', due: null, kind: 'controle' }),
    ], today);
    expect(groups.map((g) => g.urgency)).toEqual(['en_retard', 'cette_semaine', 'sans_echeance']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['c', 'a']);
  });
  it('ne compte comme urgent que le retard et les 7 prochains jours', () => {
    expect(urgentWorkCount([item({ due: '2026-10-01' }), item({ due: '2026-10-08' }), item({ due: '2026-12-01' }), item({})], today)).toBe(2);
  });
});
