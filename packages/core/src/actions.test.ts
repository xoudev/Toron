import { describe, expect, it } from 'vitest';

import { effectiveActionStatus, isOverdue, subtaskProgress } from './actions.ts';

const today = new Date('2026-07-18T12:00:00Z');
const past = new Date('2026-07-01');
const future = new Date('2026-08-01');

describe('retard calculé (RM §5.5)', () => {
  it('une action à échéance passée et non terminée est en retard', () => {
    expect(isOverdue({ status: 'en_cours', dueDate: past }, today)).toBe(true);
    expect(effectiveActionStatus({ status: 'planifie', dueDate: past }, today)).toBe('en_retard');
  });

  it('terminée ou en vérification n’est jamais en retard, même échéance passée', () => {
    expect(isOverdue({ status: 'termine', dueDate: past }, today)).toBe(false);
    expect(isOverdue({ status: 'verification', dueDate: past }, today)).toBe(false);
    expect(effectiveActionStatus({ status: 'termine', dueDate: past }, today)).toBe('termine');
  });

  it('échéance future ou absente n’est pas en retard', () => {
    expect(isOverdue({ status: 'en_cours', dueDate: future }, today)).toBe(false);
    expect(isOverdue({ status: 'en_cours', dueDate: null }, today)).toBe(false);
    expect(effectiveActionStatus({ status: 'en_cours', dueDate: future }, today)).toBe('en_cours');
  });

  it('l’échéance du jour même n’est pas encore en retard', () => {
    expect(isOverdue({ status: 'planifie', dueDate: new Date('2026-07-18') }, today)).toBe(false);
  });
});

describe('avancement par sous-tâches', () => {
  it('calcule done/total et le pourcentage', () => {
    expect(subtaskProgress([{ done: true }, { done: false }, { done: true }, { done: false }])).toEqual({
      done: 2,
      total: 4,
      pct: 50,
    });
  });

  it('renvoie pct null sans sous-tâche', () => {
    expect(subtaskProgress([])).toEqual({ done: 0, total: 0, pct: null });
  });
});
