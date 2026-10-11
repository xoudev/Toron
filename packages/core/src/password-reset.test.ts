import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RESET_TTL_SECONDS, RESET_TOKEN_PATTERN, passwordPolicyVerdict,
  passwordResetLink, publicOrigin, readResetFragment, resetIdentifierStorage, resetRequestPadding,
} from './password-reset.ts';

const TOKEN = 'JetonDeTest0000000000000';

describe('politique de mot de passe', () => {
  it('constantes', () => {
    expect(PASSWORD_RESET_TTL_SECONDS).toBe(1800);
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it('12 à 128 caractères', () => {
    const pw = (n: number) => 'x'.repeat(n);
    expect(passwordPolicyVerdict(pw(11), pw(11))).toBe('TROP_COURT');
    expect(passwordPolicyVerdict(pw(12), pw(12))).toBeNull();
    expect(passwordPolicyVerdict(pw(128), pw(128))).toBeNull();
    expect(passwordPolicyVerdict(pw(129), pw(129))).toBe('TROP_LONG');
  });

  it('la confirmation doit être identique', () => {
    expect(passwordPolicyVerdict('correct cheval pile agrafe', 'correct cheval pile agrafé')).toBe('DIFFERENTS');
    expect(passwordPolicyVerdict('correct cheval pile agrafe', 'correct cheval pile agrafe')).toBeNull();
  });

  it('la longueur prime sur la confirmation', () => {
    expect(passwordPolicyVerdict('court', 'autre')).toBe('TROP_COURT');
  });
});

describe('empreinte de l’identifiant', () => {
  it('stable, préfixée et égale au SHA-256 de l’identifiant complet', async () => {
    const identifier = `reset-password:${TOKEN}`;
    const stored = await resetIdentifierStorage(identifier);
    expect(stored).toMatch(/^reset-password:[0-9a-f]{64}$/);
    expect(await resetIdentifierStorage(identifier)).toBe(stored);
    expect(stored).toBe(`reset-password:${createHash('sha256').update(identifier).digest('hex')}`);
    expect(stored).not.toContain(TOKEN);
  });

  it('deux jetons donnent deux empreintes', async () => {
    const other = await resetIdentifierStorage(`reset-password:${TOKEN.slice(0, -1)}1`);
    expect(other).not.toBe(await resetIdentifierStorage(`reset-password:${TOKEN}`));
  });

  it('ne lève pas sur une saisie arbitraire', async () => {
    await expect(resetIdentifierStorage('reset-password:../é\u0000')).resolves.toMatch(/^reset-password:[0-9a-f]{64}$/);
  });
});

describe('lien et fragment', () => {
  it('jeton dans le fragment seulement', () => {
    expect(passwordResetLink('https://app.toron.eu', TOKEN)).toBe(`https://app.toron.eu/mot-de-passe/nouveau#jeton=${TOKEN}`);
    expect(passwordResetLink('http://localhost:3000/', TOKEN)).toBe(`http://localhost:3000/mot-de-passe/nouveau#jeton=${TOKEN}`);
  });

  it.each(['', 'abc', `${TOKEN}x`, TOKEN.slice(1), `${TOKEN.slice(0, 23)}-`, `${TOKEN.slice(0, 23)}é`])(
    'refuse le jeton mal formé « %s »', (token) => {
      expect(RESET_TOKEN_PATTERN.test(token)).toBe(false);
      expect(() => passwordResetLink('https://app.toron.eu', token)).toThrow(/mal formé/);
    },
  );

  it.each([
    'https://app.toron.eu/chemin',
    'https://app.toron.eu?x=1',
    'https://app.toron.eu/?',
    'https://app.toron.eu#a',
    'https://moi:secret@app.toron.eu',
    'javascript:alert(1)',
    'ftp://app.toron.eu',
    'app.toron.eu',
  ])('refuse l’origine « %s »', (origin) => {
    expect(() => passwordResetLink(origin, TOKEN)).toThrow(/Origine publique invalide/);
  });

  it('normalise l’origine', () => {
    expect(publicOrigin('HTTPS://App.Toron.EU:443/')).toBe('https://app.toron.eu');
  });

  it('lit le jeton du fragment, et lui seul', () => {
    expect(readResetFragment(`#jeton=${TOKEN}`)).toBe(TOKEN);
    expect(readResetFragment(`jeton=${TOKEN}`)).toBe(TOKEN);
    for (const hash of ['', '#', `#token=${TOKEN}`, `#jeton=${TOKEN}&x=1`, `#jeton=${TOKEN.slice(1)}`, `#jeton=${TOKEN}\n`, ` #jeton=${TOKEN}`]) {
      expect(readResetFragment(hash)).toBeNull();
    }
  });

  it('aller-retour lien → fragment', () => {
    const link = new URL(passwordResetLink('https://app.toron.eu', TOKEN));
    expect(readResetFragment(link.hash)).toBe(TOKEN);
    expect(link.search).toBe('');
    expect(link.pathname).toBe('/mot-de-passe/nouveau');
  });
});

describe('plancher de durée de la demande', () => {
  it('complète jusqu’à 400 ms plus la gigue', () => {
    expect(resetRequestPadding(0, 0)).toBe(400);
    expect(resetRequestPadding(100, 0)).toBe(300);
    expect(resetRequestPadding(100, 0.5)).toBe(375);
    expect(resetRequestPadding(0, 0.999)).toBe(550);
  });

  it('n’ajoute rien quand la réponse a déjà pris plus longtemps', () => {
    expect(resetRequestPadding(600, 0.2)).toBe(0);
    expect(resetRequestPadding(550, 1)).toBe(0);
  });

  it('borne les valeurs aberrantes', () => {
    expect(resetRequestPadding(0, 7)).toBe(550);
    expect(resetRequestPadding(0, -1)).toBe(400);
    expect(resetRequestPadding(0, Number.NaN)).toBe(400);
    expect(resetRequestPadding(-50, 0)).toBe(400);
  });
});
