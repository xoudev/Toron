import { describe, expect, it } from 'vitest';

import {
  awarenessSummary,
  canManageTraining,
  isLeaderRole,
  leaderTrainingDue,
  leaderTrainingState,
  trainingSessionError,
  trainingSessionState,
} from './training.ts';

const TODAY = '2026-10-07';

describe('sessions de sensibilisation', () => {
  it('une session datée après aujourd’hui est à venir', () => {
    expect(trainingSessionState('2026-11-05', TODAY)).toBe('a_venir');
    expect(trainingSessionState(TODAY, TODAY)).toBe('realisee');
  });

  it('dresse le bilan des sessions tenues sur douze mois glissants', () => {
    const sessions = [
      { heldOn: '2026-03-12', expectedCount: 42, attendedCount: 37, evidenceId: null },
      { heldOn: '2026-06-20', expectedCount: 148, attendedCount: 121, evidenceId: 'rapport' },
      { heldOn: '2026-08-28', expectedCount: null, attendedCount: 9, evidenceId: 'emargement' },
      { heldOn: '2026-11-05', expectedCount: 12, attendedCount: null, evidenceId: null },
      { heldOn: '2026-12-03', expectedCount: 20, attendedCount: null, evidenceId: null },
      { heldOn: '2025-09-30', expectedCount: 50, attendedCount: 50, evidenceId: null },
    ];
    expect(awarenessSummary(sessions, TODAY)).toEqual({
      held: 3, participations: 167, attendanceRate: 83, withoutSheet: 1, upcoming: 2, nextOn: '2026-11-05',
    });
    expect(awarenessSummary([], TODAY)).toEqual({
      held: 0, participations: 0, attendanceRate: null, withoutSheet: 0, upcoming: 0, nextOn: null,
    });
  });

  it('refuse des présents sur une session à venir, ou moins de présents que de membres cochés', () => {
    expect(trainingSessionError({ heldOn: '2026-11-05', expectedCount: 12, attendedCount: null, attendeeCount: 0 }, TODAY)).toBeNull();
    expect(trainingSessionError({ heldOn: '2026-11-05', expectedCount: 12, attendedCount: 10, attendeeCount: 0 }, TODAY)).toMatch(/à venir/);
    expect(trainingSessionError({ heldOn: '2026-03-12', expectedCount: 42, attendedCount: 1, attendeeCount: 2 }, TODAY)).toMatch(/inférieur/);
    expect(trainingSessionError({ heldOn: '2026-03-12', expectedCount: 42, attendedCount: 37, attendeeCount: 2 }, TODAY)).toBeNull();
  });
});

describe('droits', () => {
  it('les gestionnaires planifient et enregistrent, l’auditeur et le lecteur consultent', () => {
    expect(canManageTraining('rssi')).toBe(true);
    expect(canManageTraining('resp_qualite')).toBe(true);
    expect(canManageTraining('contributeur')).toBe(true);
    expect(canManageTraining('auditeur')).toBe(false);
    expect(canManageTraining('lecteur')).toBe(false);
  });
});

describe('formation des dirigeants (NIS 2, art. 20)', () => {
  it('seuls le propriétaire et la direction sont des organes de direction', () => {
    expect(isLeaderRole('direction')).toBe(true);
    expect(isLeaderRole('owner')).toBe(true);
    expect(isLeaderRole('rssi')).toBe(false);
  });

  it('une formation vaut douze mois ; son renouvellement se planifie deux mois avant', () => {
    expect(leaderTrainingDue('2025-11-18')).toBe('2026-11-18');
    expect(leaderTrainingState('2026-01-15', TODAY)).toBe('a_jour');
    expect(leaderTrainingState('2025-12-07', TODAY)).toBe('a_jour');
    expect(leaderTrainingState('2025-11-18', TODAY)).toBe('bientot');
    expect(leaderTrainingState('2025-10-07', TODAY)).toBe('bientot');
    expect(leaderTrainingState('2025-10-06', TODAY)).toBe('a_renouveler');
    expect(leaderTrainingState(null, TODAY)).toBe('jamais');
  });
});
