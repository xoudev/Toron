import { describe, expect, it } from 'vitest';

import { deriveProcessHealth, processMutualizationCount, type ProcessRequirement, type ProcessKpi } from './processes.ts';

const kpi = (tone: ProcessKpi['tone']): ProcessKpi => ({ label: 'x', actual: '1', target: '2', tone });

describe('santé du processus (dérivée des indicateurs)', () => {
  it('sain quand tous les indicateurs sont au vert', () => {
    expect(deriveProcessHealth([kpi('ok'), kpi('ok')])).toBe('sain');
  });

  it('à surveiller dès qu’un indicateur est sous sa cible', () => {
    expect(deriveProcessHealth([kpi('ok'), kpi('warn')])).toBe('a_surveiller');
  });

  it('en alerte sur un indicateur critique', () => {
    expect(deriveProcessHealth([kpi('ok'), kpi('danger')])).toBe('en_alerte');
  });

  it('en alerte dès qu’une non-conformité est ouverte, même au vert', () => {
    expect(deriveProcessHealth([kpi('ok')], 1)).toBe('en_alerte');
  });
});

describe('mutualisation sécurité ⇄ qualité', () => {
  it('compte les exigences adossées à un contrôle 27001', () => {
    const reqs: ProcessRequirement[] = [
      { framework: '9001', code: '§8.5', mutualized: false },
      { framework: '27001', code: 'A.8.16', mutualized: true },
      { framework: '27001', code: 'A.7.1', mutualized: true },
    ];
    expect(processMutualizationCount(reqs)).toBe(2);
    expect(processMutualizationCount([])).toBe(0);
  });
});
