import { describe, expect, it } from 'vitest';

import { parseMailDatabaseUrl, parseMailEnv } from './env.ts';

const KEY = 'dev_local_cle_courriel_32_caracteres_min';
const TEM_KEY = '11111111-2222-4333-8444-555555555555';
const PROJECT = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const DB = 'postgres://toron_mail_login:toron_mail_dev_only@localhost:5432/toron';

const LOCAL = {
  TORON_ENV: 'local',
  DATABASE_URL_MAIL: DB,
  MAIL_OUTBOX_KEY: KEY,
  MAIL_TRANSPORT: 'fichier',
  MAIL_FROM: 'ne-pas-repondre@toron.localhost',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  MAIL_FICHIER_DIR: '/var/toron/courriels',
};

const PRODUCTION = {
  TORON_ENV: 'production',
  DATABASE_URL_MAIL: DB,
  MAIL_OUTBOX_KEY: KEY,
  MAIL_TRANSPORT: 'scaleway',
  MAIL_FROM: 'ne-pas-repondre@notifications.toron.eu',
  PUBLIC_BASE_URL: 'https://app.toron.eu',
  SCW_TEM_SECRET_KEY: TEM_KEY,
  SCW_TEM_PROJECT_ID: PROJECT,
};

const STAGING = {
  ...PRODUCTION,
  TORON_ENV: 'staging',
  MAIL_FROM: 'ne-pas-repondre@staging.notifications.toron.eu',
  PUBLIC_BASE_URL: 'https://staging.toron.eu',
  MAIL_DESTINATAIRES_AUTORISES: 'toron.eu, rssi@meridiane-logistics.fr',
};

function errorsOf(source: Record<string, string | undefined>): string[] {
  const result = parseMailEnv(source);
  if (result.ok) throw new Error('environnement accepté à tort');
  return result.errors;
}

describe('environnement du service mail', () => {
  it('accepte le local en transport fichier, avec les valeurs par défaut', () => {
    const result = parseMailEnv(LOCAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.transport).toEqual({ kind: 'fichier', dir: '/var/toron/courriels' });
    expect(result.env.pollMs).toBe(2000);
    expect(result.env.suspended).toBe(false);
    expect(result.env.allowlist).toBeNull();
    expect(result.env.publicBaseUrl).toBe('http://localhost:3000');
  });

  it('accepte la production en Scaleway, région fr-par par défaut', () => {
    const result = parseMailEnv(PRODUCTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.transport).toEqual({ kind: 'scaleway', secretKey: TEM_KEY, projectId: PROJECT, region: 'fr-par' });
  });

  it('accepte le staging en Scaleway avec une liste blanche normalisée', () => {
    const result = parseMailEnv(STAGING);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.allowlist).toEqual(['toron.eu', 'rssi@meridiane-logistics.fr']);
  });

  it('exige TORON_ENV et MAIL_TRANSPORT, sans valeur par défaut', () => {
    expect(errorsOf({ ...LOCAL, TORON_ENV: undefined }).join('\n')).toMatch(/TORON_ENV manquante/);
    expect(errorsOf({ ...LOCAL, MAIL_TRANSPORT: '' }).join('\n')).toMatch(/MAIL_TRANSPORT manquante ou invalide/);
    expect(errorsOf({ ...LOCAL, MAIL_TRANSPORT: 'console' }).join('\n')).toMatch(/scaleway ou fichier/);
  });

  it('refuse le transport scaleway en local et en ci', () => {
    for (const toronEnv of ['local', 'ci']) {
      const errors = errorsOf({ ...PRODUCTION, TORON_ENV: toronEnv, PUBLIC_BASE_URL: 'http://localhost:3000' });
      expect(errors.join('\n')).toMatch(new RegExp(`MAIL_TRANSPORT=scaleway refusé avec TORON_ENV=${toronEnv}`));
      expect(errors.join('\n')).toMatch(/SCW_TEM_SECRET_KEY refusée/);
    }
  });

  it('refuse le transport fichier et MAIL_FICHIER_DIR en production', () => {
    const errors = errorsOf({ ...PRODUCTION, MAIL_TRANSPORT: 'fichier', MAIL_FICHIER_DIR: '/var/toron/courriels' });
    expect(errors.join('\n')).toMatch(/MAIL_TRANSPORT=fichier refusé en production/);
    expect(errors.join('\n')).toMatch(/MAIL_FICHIER_DIR refusée en production/);
  });

  it('refuse scaleway en staging sans liste blanche', () => {
    const errors = errorsOf({ ...STAGING, MAIL_DESTINATAIRES_AUTORISES: undefined });
    expect(errors.join('\n')).toMatch(/MAIL_DESTINATAIRES_AUTORISES manquante — obligatoire en staging/);
  });

  it('refuse une liste blanche en production', () => {
    const errors = errorsOf({ ...PRODUCTION, MAIL_DESTINATAIRES_AUTORISES: 'toron.eu' });
    expect(errors.join('\n')).toMatch(/MAIL_DESTINATAIRES_AUTORISES refusée en production/);
  });

  it('refuse une liste blanche mal formée', () => {
    const errors = errorsOf({ ...STAGING, MAIL_DESTINATAIRES_AUTORISES: 'toron.eu,,pas une adresse' });
    expect(errors.join('\n')).toMatch(/MAIL_DESTINATAIRES_AUTORISES invalide/);
  });

  it('exige https hors local et ci, et une origine sans chemin', () => {
    expect(errorsOf({ ...PRODUCTION, PUBLIC_BASE_URL: 'http://app.toron.eu' }).join('\n')).toMatch(/https/);
    expect(errorsOf({ ...LOCAL, PUBLIC_BASE_URL: 'http://localhost:3000/app' }).join('\n')).toMatch(/origine seule/);
  });

  it('exige les identifiants Scaleway avec le transport scaleway', () => {
    const errors = errorsOf({ ...PRODUCTION, SCW_TEM_SECRET_KEY: undefined, SCW_TEM_PROJECT_ID: undefined });
    expect(errors.join('\n')).toMatch(/SCW_TEM_SECRET_KEY manquante/);
    expect(errors.join('\n')).toMatch(/SCW_TEM_PROJECT_ID manquante/);
  });

  it('refuse un expéditeur de domaine réservé avec scaleway', () => {
    const errors = errorsOf({ ...PRODUCTION, MAIL_FROM: 'ne-pas-repondre@toron.localhost' });
    expect(errors.join('\n')).toMatch(/MAIL_FROM invalide avec MAIL_TRANSPORT=scaleway/);
  });

  it('exige un répertoire absolu en transport fichier', () => {
    expect(errorsOf({ ...LOCAL, MAIL_FICHIER_DIR: undefined }).join('\n')).toMatch(/MAIL_FICHIER_DIR manquante/);
    expect(errorsOf({ ...LOCAL, MAIL_FICHIER_DIR: 'courriels' }).join('\n')).toMatch(/chemin absolu/);
  });

  it('borne MAIL_POLL_MS et reconnaît l’interrupteur de suspension', () => {
    expect(errorsOf({ ...LOCAL, MAIL_POLL_MS: '50' }).join('\n')).toMatch(/MAIL_POLL_MS trop faible/);
    expect(errorsOf({ ...LOCAL, MAIL_ENVOI_SUSPENDU: 'oui' }).join('\n')).toMatch(/MAIL_ENVOI_SUSPENDU invalide/);
    const result = parseMailEnv({ ...LOCAL, MAIL_ENVOI_SUSPENDU: '1', MAIL_POLL_MS: '500' });
    expect(result.ok && result.env.suspended && result.env.pollMs === 500).toBe(true);
  });

  it('ne recopie jamais une valeur secrète dans les messages', () => {
    const weakKey = 'cle-trop-courte-secrete';
    const errors = errorsOf({
      ...PRODUCTION,
      TORON_ENV: 'local',
      MAIL_OUTBOX_KEY: weakKey,
      SCW_TEM_SECRET_KEY: 'cle-invalide',
      DATABASE_URL_MAIL: 'mysql://toron:motdepasse@db/toron',
    });
    const joined = errors.join('\n');
    expect(errors.length).toBeGreaterThanOrEqual(3);
    for (const secret of [weakKey, 'cle-invalide', 'motdepasse']) expect(joined).not.toContain(secret);
  });

  it('valide seule la chaîne de connexion pour la CLI d’état', () => {
    expect(parseMailDatabaseUrl({ DATABASE_URL_MAIL: DB })).toEqual({ ok: true, env: DB });
    const missing = parseMailDatabaseUrl({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]).toMatch(/DATABASE_URL_MAIL manquante/);
  });
});
