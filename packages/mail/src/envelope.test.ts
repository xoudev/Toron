import { describe, expect, it } from 'vitest';

import { deriveOutboxKey, keyId, open, seal } from './envelope.ts';

const KEY = deriveOutboxKey('cle-de-developpement-toron-locale-0001');
const PREVIOUS = deriveOutboxKey('ancienne-cle-de-developpement-toron-0001');
const ID = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const TOKEN = 'JetonDeTest0000000000000';
const CONTEXT = { id: ID, kind: 'mot_de_passe_reinitialisation' } as const;

describe('dérivation de la clé', () => {
  it('32 octets, stable, identifiant k + 8 hex', () => {
    expect(KEY).toHaveLength(32);
    expect(deriveOutboxKey('cle-de-developpement-toron-locale-0001').equals(KEY)).toBe(true);
    expect(keyId(KEY)).toMatch(/^k[0-9a-f]{8}$/);
    expect(keyId(PREVIOUS)).not.toBe(keyId(KEY));
  });

  it('refuse une clé de moins de 32 caractères', () => {
    expect(() => deriveOutboxKey('x'.repeat(31))).toThrow(/32 caractères/);
  });
});

describe('scellement', () => {
  it('aller-retour, sans le secret en clair dans la boîte', () => {
    const box = seal(KEY, CONTEXT, TOKEN);
    expect(box.length).toBe(12 + TOKEN.length + 16);
    expect(box.toString('latin1')).not.toContain(TOKEN);
    expect(open([KEY], { ...CONTEXT, keyId: keyId(KEY) }, box)).toBe(TOKEN);
  });

  it('deux scellements du même secret diffèrent (IV aléatoire)', () => {
    expect(seal(KEY, CONTEXT, TOKEN).equals(seal(KEY, CONTEXT, TOKEN))).toBe(false);
  });

  it('l’identifiant de ligne est comparé sans tenir compte de la casse', () => {
    const box = seal(KEY, { ...CONTEXT, id: ID.toUpperCase() }, TOKEN);
    expect(open([KEY], { ...CONTEXT, keyId: keyId(KEY) }, box)).toBe(TOKEN);
  });

  it('un octet modifié fait échouer l’ouverture', () => {
    const box = seal(KEY, CONTEXT, TOKEN);
    for (const i of [0, 12, box.length - 1]) {
      const altered = Buffer.from(box);
      altered[i] = altered[i]! ^ 0x01;
      expect(open([KEY], { ...CONTEXT, keyId: keyId(KEY) }, altered)).toBeNull();
    }
  });

  it('une autre ligne ou un autre type font échouer l’ouverture', () => {
    const box = seal(KEY, CONTEXT, TOKEN);
    const other = '1f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    expect(open([KEY], { id: other, kind: CONTEXT.kind, keyId: keyId(KEY) }, box)).toBeNull();
    expect(open([KEY], { id: ID, kind: 'mot_de_passe_modifie', keyId: keyId(KEY) }, box)).toBeNull();
  });

  it('une mauvaise clé fait échouer l’ouverture', () => {
    const box = seal(KEY, CONTEXT, TOKEN);
    expect(open([PREVIOUS], { ...CONTEXT, keyId: keyId(KEY) }, box)).toBeNull();
    expect(open([PREVIOUS], { ...CONTEXT, keyId: keyId(PREVIOUS) }, box)).toBeNull();
  });

  it('la clé précédente ouvre les boîtes scellées avant la rotation', () => {
    const before = seal(PREVIOUS, CONTEXT, TOKEN);
    const after = seal(KEY, CONTEXT, TOKEN);
    const keys = [KEY, PREVIOUS];
    expect(open(keys, { ...CONTEXT, keyId: keyId(PREVIOUS) }, before)).toBe(TOKEN);
    expect(open(keys, { ...CONTEXT, keyId: keyId(KEY) }, after)).toBe(TOKEN);
    expect(open([KEY], { ...CONTEXT, keyId: keyId(PREVIOUS) }, before)).toBeNull();
  });

  it('boîte tronquée ou vide : null, sans exception', () => {
    const box = seal(KEY, CONTEXT, TOKEN);
    expect(open([KEY], { ...CONTEXT, keyId: keyId(KEY) }, box.subarray(0, 28))).toBeNull();
    expect(open([KEY], { ...CONTEXT, keyId: keyId(KEY) }, Buffer.alloc(0))).toBeNull();
  });

  it('respecte les bornes de la contrainte secret_box (29 à 512 octets)', () => {
    expect(seal(KEY, CONTEXT, 'x')).toHaveLength(29);
    expect(seal(KEY, CONTEXT, 'x'.repeat(484))).toHaveLength(512);
    expect(() => seal(KEY, CONTEXT, 'x'.repeat(485))).toThrow(/trop long/);
    expect(() => seal(KEY, CONTEXT, '')).toThrow(/vide/);
  });

  it('refuse un identifiant qui n’est pas un UUID ou une clé mal dimensionnée', () => {
    expect(() => seal(KEY, { ...CONTEXT, id: `${ID}|x` }, TOKEN)).toThrow(/UUID/);
    expect(() => seal(KEY.subarray(0, 16), CONTEXT, TOKEN)).toThrow(/32 octets/);
  });
});
