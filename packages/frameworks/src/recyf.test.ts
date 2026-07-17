import { describe, expect, it } from 'vitest';

import { recyf } from './recyf.ts';

describe('référentiel ReCyF v2.5', () => {
  const data = recyf();

  it('contient les 20 objectifs de sécurité, dans l’ordre', () => {
    expect(data.objectives).toHaveLength(20);
    data.objectives.forEach((obj, i) => {
      expect(obj.number).toBe(i + 1);
      expect(obj.ref).toBe(`OBJ-${String(i + 1).padStart(2, '0')}`);
    });
  });

  it('applique la proportionnalité : 1–15 pour EI+EE, 16–20 pour EE seules', () => {
    for (const obj of data.objectives) {
      expect(obj.appliesTo).toBe(obj.number <= 15 ? 'ei_ee' : 'ee');
    }
  });

  it('couvre l’intégralité des moyens acceptables de conformité (152)', () => {
    const total = data.objectives.reduce((n, o) => n + o.means.length, 0);
    expect(total).toBe(152);
  });

  it('a des codes de moyens uniques et rattachés à leur objectif', () => {
    const refs = new Set<string>();
    for (const obj of data.objectives) {
      for (const mean of obj.means) {
        expect(refs.has(mean.ref)).toBe(false);
        refs.add(mean.ref);
        expect(mean.ref.startsWith(`${obj.number}.`)).toBe(true);
      }
    }
  });

  it('ne contient jamais de moyen inapplicable aux deux types d’entités', () => {
    for (const obj of data.objectives) {
      for (const mean of obj.means) {
        expect(mean.ei || mean.ee).toBe(true);
      }
    }
  });
});
