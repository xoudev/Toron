import { describe, expect, it } from 'vitest';

import { auditChainVerdict } from './audit-chain.ts';

describe('auditChainVerdict', () => {
  it('journal vide : rien à vérifier, rien d’alarmant', () => {
    expect(auditChainVerdict({ entries: 0, lastSeq: 0, headSeq: 0, brokenAtSeq: null }))
      .toMatchObject({ intact: true, title: 'Journal vide' });
  });

  it('chaîne intègre : dit combien d’entrées ont été vérifiées', () => {
    const v = auditChainVerdict({ entries: 1234, lastSeq: 1234, headSeq: 1234, brokenAtSeq: null });
    expect(v.intact).toBe(true);
    expect(v.title).toBe('Chaîne intègre');
    expect(v.detail).toMatch(/^1\s234 entrées vérifiées, de la n° 1 à la n° 1\s234/);
  });

  it('une seule entrée : accord au singulier', () => {
    expect(auditChainVerdict({ entries: 1, lastSeq: 1, headSeq: 1, brokenAtSeq: null }).detail)
      .toMatch(/^1 entrée vérifiée,/);
  });

  it('rupture au milieu : situe l’entrée et ce qui reste cohérent', () => {
    const v = auditChainVerdict({ entries: 9, lastSeq: 10, headSeq: 10, brokenAtSeq: 4 });
    expect(v.intact).toBe(false);
    expect(v.title).toBe('Rupture détectée à l’entrée n° 4');
    expect(v.detail).toContain('Les entrées n° 1 à 3 restent cohérentes entre elles.');
    expect(v.detail).toContain('Exportez le journal en l’état');
  });

  it('rupture dès la première entrée : rien n’est dit cohérent', () => {
    const v = auditChainVerdict({ entries: 5, lastSeq: 5, headSeq: 5, brokenAtSeq: 1 });
    expect(v.detail).not.toContain('restent cohérentes');
  });

  it('dernières entrées effacées : la tête de chaîne en annonce davantage', () => {
    const v = auditChainVerdict({ entries: 3, lastSeq: 3, headSeq: 5, brokenAtSeq: 4 });
    expect(v.title).toBe('Rupture détectée en fin de journal');
    expect(v.detail).toContain('La base a numéroté 5 entrées, il n’en reste que 3 : les entrées n° 4 à 5 ont été effacées');
  });

  it('une seule entrée effacée en fin de journal', () => {
    const v = auditChainVerdict({ entries: 4, lastSeq: 4, headSeq: 5, brokenAtSeq: 5 });
    expect(v.detail).toContain('l’entrée n° 5 a été effacée');
  });

  it('dernière entrée remplacée sans changer le numéro', () => {
    const v = auditChainVerdict({ entries: 5, lastSeq: 5, headSeq: 5, brokenAtSeq: 6 });
    expect(v.detail).toContain('La dernière entrée (n° 5) ne correspond plus à la tête de chaîne');
  });
});
