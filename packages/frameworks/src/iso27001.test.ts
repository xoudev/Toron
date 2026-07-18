import { describe, expect, it } from 'vitest';

import { iso27001, iso27001AnnexAControlCount } from './iso27001.ts';

describe('référentiel ISO/IEC 27001:2022', () => {
  const data = iso27001();

  it('couvre les clauses 4 à 10 du système de management', () => {
    expect(data.clauses.map((c) => c.ref)).toEqual(['4', '5', '6', '7', '8', '9', '10']);
  });

  it('couvre les 93 contrôles de l’Annexe A (37 + 8 + 14 + 34)', () => {
    const parTheme = Object.fromEntries(data.themes.map((t) => [t.ref, t.controls.length]));
    expect(parTheme).toEqual({ 'A.5': 37, 'A.6': 8, 'A.7': 14, 'A.8': 34 });
    expect(iso27001AnnexAControlCount(data)).toBe(93);
  });

  it('numérote les contrôles de chaque thème sans trou ni doublon', () => {
    for (const theme of data.themes) {
      const nums = theme.controls.map((c) => Number(c.ref.split('.')[2]));
      expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
      for (const c of theme.controls) {
        expect(c.ref.startsWith(`${theme.ref}.`)).toBe(true);
      }
    }
  });

  it('a des identifiants de contrôles globalement uniques', () => {
    const refs = data.themes.flatMap((t) => t.controls.map((c) => c.ref));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('inclut les points d’ancrage du cross-mapping de la démo (A.5.19, A.8.5, A.8.13)', () => {
    const refs = new Set(data.themes.flatMap((t) => t.controls.map((c) => c.ref)));
    for (const ref of ['A.5.19', 'A.8.5', 'A.8.13']) {
      expect(refs.has(ref)).toBe(true);
    }
  });

  it('porte une note de source rappelant l’origine maison des reformulations (P4)', () => {
    expect(data.sourceNote.toLowerCase()).toContain('maison');
  });
});
