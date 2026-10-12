import { describe, expect, it } from 'vitest';

import { scrubLogMessage } from './auth-options.ts';

describe('scrubLogMessage — journal Better Auth filtré', () => {
  it('masque adresses et jetons', () => {
    const out = scrubLogMessage('Invalid redirectURL: https://x/?u=jean.dupont@exemple.fr jeton AbCdEfGhIjKlMnOpQrStUvWx');
    expect(out).not.toContain('@');
    expect(out).not.toContain('AbCdEfGhIjKlMnOpQrStUvWx');
    expect(out).toContain('[adresse]');
    expect(out).toContain('[masqué]');
  });

  it('écrit une seule ligne : un retour à la ligne injecté ne forge pas une entrée', () => {
    const separators = ['\r\n', '\n', String.fromCharCode(0x0b), String.fromCharCode(0x2028), String.fromCharCode(0x85)];
    for (const sep of separators) {
      const out = scrubLogMessage(`Invalid redirectURL: https://x/${sep}[courriel] réinitialisation · plafond global de la file atteint`);
      expect(out).not.toMatch(/[\r\n\v]/);
      expect(out).not.toContain(String.fromCharCode(0x2028));
      expect(out).not.toContain(String.fromCharCode(0x85));
    }
  });

  it('tronque un message long et le traite en temps linéaire', () => {
    const long = 'a'.repeat(1_000_000);
    const started = performance.now();
    const out = scrubLogMessage(`Invalid callbackURL: ${long}`);
    expect(performance.now() - started).toBeLessThan(50);
    expect(out.length).toBeLessThanOrEqual(300);
  });

  it('accepte un message qui n’est pas une chaîne sans lever', () => {
    const err = new Error('Failed query: params: jean.dupont@exemple.fr');
    expect(scrubLogMessage(err)).toBe('Error');
    expect(scrubLogMessage({ email: 'jean.dupont@exemple.fr' })).toBe('[message non textuel]');
    expect(scrubLogMessage(undefined)).toBe('[message non textuel]');
  });
});
