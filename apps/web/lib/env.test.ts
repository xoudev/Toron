import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.ts';

const BASE = {
  DATABASE_URL_APP: 'postgres://app@localhost/toron',
  DATABASE_URL_AUTH: 'postgres://auth@localhost/toron',
  BETTER_AUTH_SECRET: 's'.repeat(32),
  BETTER_AUTH_URL: 'https://app.toron.eu',
};
const KEY = 'k'.repeat(32);

describe('environnement du web', () => {
  it('vaut local par défaut, où la clé de la file est facultative', () => {
    const e = parseEnv({ ...BASE, BETTER_AUTH_URL: 'http://localhost:3000' });
    expect(e.TORON_ENV).toBe('local');
    expect(e.MAIL_OUTBOX_KEY).toBeUndefined();
    expect(parseEnv({ ...BASE, MAIL_OUTBOX_KEY: '' }).MAIL_OUTBOX_KEY).toBeUndefined();
  });

  it.each(['staging', 'production'])('exige en %s la clé de la file et une URL https', (toronEnv) => {
    expect(() => parseEnv({ ...BASE, TORON_ENV: toronEnv })).toThrow(/MAIL_OUTBOX_KEY manquante/);
    expect(() => parseEnv({ ...BASE, TORON_ENV: toronEnv, MAIL_OUTBOX_KEY: KEY, BETTER_AUTH_URL: 'http://app.toron.eu' }))
      .toThrow(/BETTER_AUTH_URL doit être en https/);
    expect(parseEnv({ ...BASE, TORON_ENV: toronEnv, MAIL_OUTBOX_KEY: KEY }).MAIL_OUTBOX_KEY).toBe(KEY);
  });

  it('refuse une clé trop courte et un TORON_ENV inconnu', () => {
    expect(() => parseEnv({ ...BASE, MAIL_OUTBOX_KEY: 'courte' })).toThrow(/MAIL_OUTBOX_KEY trop courte/);
    expect(() => parseEnv({ ...BASE, TORON_ENV: 'prod' })).toThrow(/TORON_ENV invalide/);
  });
});
