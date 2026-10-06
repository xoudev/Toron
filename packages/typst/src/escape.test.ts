import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import type { BoardModel } from './board-model.ts';
import { compileBoard } from './compile.ts';
import { typstText } from './escape.ts';

describe('échappement du texte utilisateur', () => {
  it('neutralise les commentaires, le code et les blocs', () => {
    expect(typstText('TLS 1.2 // 1.3')).toBe('TLS 1.2 \\/\\/ 1.3');
    expect(typstText('/* note */')).toBe('\\/\\* note \\*\\/');
    expect(typstText('#import "x"')).toBe('\\#import "x"');
    expect(typstText('fin] #code[')).toBe('fin\\] \\#code\\[');
  });

  it('neutralise les marqueurs de titre, de liste et d’énumération', () => {
    expect(typstText('= Titre')).toBe('\\= Titre');
    expect(typstText('- puce')).toBe('\\- puce');
    expect(typstText('+ item')).toBe('\\+ item');
    expect(typstText('1. premier')).toBe('1\\. premier');
    expect(typstText('Version 2.1 du 3.4')).toBe('Version 2.1 du 3.4');
  });

  it('ramène tous les sauts de ligne Unicode à un espace', () => {
    expect(typstText('a\r\nb\u2028c\u2029d\u0085e\u000bf\u000cg')).toBe('a b c d e f g');
  });

  it('laisse le texte courant intact', () => {
    expect(typstText('Hébergeur cloud souverain — Lyon')).toBe('Hébergeur cloud souverain — Lyon');
  });
});

// Compilation réelle quand le binaire Typst est disponible (image du worker, CI outillée).
const typstBin = process.env['TYPST_BIN'] ?? 'typst';
const typstAvailable = spawnSync(typstBin, ['--version']).status === 0;

describe.skipIf(!typstAvailable)('compilation avec des saisies hostiles', () => {
  it('le rapport de direction se compile malgré // , # , ] et les marqueurs', async () => {
    const hostile = 'TLS 1.2 // 1.3 ] #panic("x") /* = - + 1. ';
    const model: BoardModel = {
      organisationName: hostile,
      headline: hostile,
      situationLabel: '6 octobre 2026',
      generatedAtLabel: '6 octobre 2026 à 20:00',
      messages: [{ tone: 'alerte', text: hostile }],
      decisions: [hostile],
      kpis: [{ label: hostile, value: '1 / 2' }],
      nis2: [{ title: hostile, detail: hostile }],
      frameworks: [hostile],
      risks: [{ ref: 'RSK-001', title: hostile, level: 'Élevé', treatment: 'Réduire', owner: hostile }],
      overdueActions: [{ ref: 'ACT-001', title: hostile, priority: 'P1', due: '1 octobre 2026', owner: hostile }],
      verifyUrl: 'https://toron.example/verifier/abc',
      verifySlug: 'abc',
    };
    const pdf = await compileBoard(model);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  }, 30_000);
});
