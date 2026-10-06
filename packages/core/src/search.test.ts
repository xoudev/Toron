import { describe, expect, it } from 'vitest';

import { likeContains, parseSearchQuery, refCodeFor, refNumber } from './search.ts';

describe('recherche transverse', () => {
  it('reconnaît un code d’élément sous plusieurs écritures', () => {
    expect(parseSearchQuery('ACT-098')).toEqual({ type: 'code', kind: 'action', number: 98, text: 'ACT-098' });
    expect(parseSearchQuery(' rsk 5 ')).toMatchObject({ type: 'code', kind: 'risque', number: 5 });
    expect(parseSearchQuery('NC-177')).toMatchObject({ type: 'code', kind: 'nc', number: 177 });
  });
  it('traite le reste comme du texte, borné et nettoyé', () => {
    expect(parseSearchQuery('A.5.19')).toEqual({ type: 'texte', text: 'A.5.19' });
    expect(parseSearchQuery('XYZ-12')).toEqual({ type: 'texte', text: 'XYZ-12' });
    expect(parseSearchQuery('a')).toEqual({ type: 'vide' });
    expect(parseSearchQuery('  sauvegardes\u0000   WMS ')).toEqual({ type: 'texte', text: 'sauvegardes WMS' });
    const long = parseSearchQuery('x'.repeat(500));
    expect(long.type === 'texte' && long.text.length).toBe(80);
  });
  it('dérive le code lisible comme l’affichage', () => {
    expect(refNumber('d0000000-0000-4000-8000-000000000062')).toBe(98);
    expect(refCodeFor('action', 'd0000000-0000-4000-8000-000000000062')).toBe('ACT-098');
    expect(refCodeFor('exigence', 'd0000000-0000-4000-8000-000000000062')).toBeNull();
  });
  it('neutralise les jokers SQL de la saisie', () => {
    expect(likeContains('100%_sûr\\')).toBe('%100\\%\\_sûr\\\\%');
  });
});
