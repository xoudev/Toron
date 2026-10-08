import { describe, expect, it } from 'vitest';

import {
  activityContinuityState,
  activityError,
  biaReviewDue,
  canManageContinuity,
  continuitySummary,
  exerciseError,
} from './continuity.ts';

const TODAY = '2026-10-08';

describe('état des activités critiques', () => {
  it('une activité sans exercice réalisé sur douze mois n’est pas testée', () => {
    expect(activityContinuityState({ rtoHours: 8, lastExercise: null }, TODAY)).toBe('non_teste');
    expect(activityContinuityState({ rtoHours: 8, lastExercise: { heldOn: '2025-10-08', result: 'atteint', recoveryMinutes: 60 } }, TODAY)).toBe('non_teste');
    expect(activityContinuityState({ rtoHours: 8, lastExercise: { heldOn: '2025-10-09', result: 'atteint', recoveryMinutes: 60 } }, TODAY)).toBe('teste');
  });

  it('une reprise mesurée au-delà de la DMIA vaut objectif manqué, quel que soit le résultat déclaré', () => {
    expect(activityContinuityState({ rtoHours: 24, lastExercise: { heldOn: '2026-06-20', result: 'atteint', recoveryMinutes: 270 } }, TODAY)).toBe('teste');
    expect(activityContinuityState({ rtoHours: 4, lastExercise: { heldOn: '2026-06-20', result: 'atteint', recoveryMinutes: 270 } }, TODAY)).toBe('objectif_manque');
    expect(activityContinuityState({ rtoHours: 24, lastExercise: { heldOn: '2026-06-20', result: 'non_atteint', recoveryMinutes: null } }, TODAY)).toBe('objectif_manque');
    expect(activityContinuityState({ rtoHours: 8, lastExercise: { heldOn: '2026-05-14', result: 'partiel', recoveryMinutes: null } }, TODAY)).toBe('partiel');
  });

  it('le bilan d’impact se revoit un an après', () => {
    expect(biaReviewDue('2025-09-15')).toBe('2026-09-15');
  });
});

describe('saisie', () => {
  it('DMIA et PDMA en heures entières, positives, d’un an au plus', () => {
    expect(activityError({ rtoHours: 8, rpoHours: 1 })).toBeNull();
    expect(activityError({ rtoHours: -1, rpoHours: 1 })).toMatch(/positives/);
    expect(activityError({ rtoHours: 1.5, rpoHours: 1 })).toMatch(/entières/);
    expect(activityError({ rtoHours: 9000, rpoHours: 1 })).toMatch(/un an/);
  });

  it('un exercice futur ne se déclare pas réalisé ; un objectif manqué se documente', () => {
    const base = { scheduledOn: '2026-06-20', result: null, recoveryMinutes: null, findings: null } as const;
    expect(exerciseError({ ...base, status: 'planifie' }, TODAY)).toBeNull();
    expect(exerciseError({ ...base, status: 'planifie', result: 'atteint' }, TODAY)).toMatch(/une fois l’exercice réalisé/);
    expect(exerciseError({ ...base, status: 'realise', scheduledOn: '2026-11-20', result: 'atteint' }, TODAY)).toMatch(/futur/);
    expect(exerciseError({ ...base, status: 'realise' }, TODAY)).toMatch(/résultat/);
    expect(exerciseError({ ...base, status: 'realise', result: 'partiel', findings: 'trop court' }, TODAY)).toBeNull();
    expect(exerciseError({ ...base, status: 'realise', result: 'partiel', findings: 'court' }, TODAY)).toMatch(/documente/);
    expect(exerciseError({ ...base, status: 'realise', result: 'atteint', recoveryMinutes: 270 }, TODAY)).toBeNull();
  });
});

describe('pilotage', () => {
  it('compte les activités vitales, les activités critiques non testées, les objectifs manqués et les BIA à revoir', () => {
    expect(continuitySummary([
      { criticality: 4, state: 'partiel', assessedOn: '2026-02-10' },
      { criticality: 3, state: 'teste', assessedOn: '2026-02-10' },
      { criticality: 3, state: 'non_teste', assessedOn: '2026-02-10' },
      { criticality: 2, state: 'non_teste', assessedOn: '2025-09-15' },
      { criticality: 4, state: 'objectif_manque', assessedOn: '2026-02-10' },
    ], TODAY)).toEqual({ activities: 5, vital: 2, tested: 3, criticalUntested: 1, objectiveMissed: 1, biaDue: 1 });
  });

  it('les gestionnaires tiennent le BIA, l’auditeur et le lecteur consultent', () => {
    expect(canManageContinuity('rssi')).toBe(true);
    expect(canManageContinuity('auditeur')).toBe(false);
    expect(canManageContinuity('lecteur')).toBe(false);
  });
});
