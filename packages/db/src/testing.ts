import { randomBytes } from 'node:crypto';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

import { applyMigrations } from './migrate.ts';
import { PG_IMAGE } from './test-image.ts';

// ── Harnais de test partagé (testcontainers) ────────────────────────────
// Réservé aux tests d'intégration des autres paquets : un Postgres jetable,
// migré, avec des logins porteurs des rôles runtime réels. Jamais importé
// par du code de production.

const LOGIN_ROLES = {
  app: 'toron_app',
  auth: 'toron_auth',
  mail: 'toron_mail',
} as const;

export type TestLogin = keyof typeof LOGIN_ROLES;

export interface TestDatabase<L extends TestLogin> {
  /** Superutilisateur du conteneur : préparation et contrôles seulement. */
  adminUri: string;
  /** Une URI par login demandé, chacun membre du seul rôle runtime correspondant. */
  uris: Record<L, string>;
  stop: () => Promise<void>;
}

/** Démarre un Postgres migré et crée les logins demandés (mot de passe aléatoire). */
export async function startTestDatabase<L extends TestLogin>(options: { logins: readonly L[] }): Promise<TestDatabase<L>> {
  const container = await new PostgreSqlContainer(PG_IMAGE).start();
  try {
    const adminUri = container.getConnectionUri();
    await applyMigrations(adminUri);

    const admin = postgres(adminUri, { max: 1, onnotice: () => {} });
    const uris = {} as Record<L, string>;
    try {
      for (const login of new Set(options.logins)) {
        if (!Object.hasOwn(LOGIN_ROLES, login)) {
          throw new Error(`startTestDatabase : login « ${String(login)} » inconnu — attendus : app, auth, mail.`);
        }
        const name = `${login}_login`;
        const password = randomBytes(16).toString('hex');
        // Identifiants issus de LOGIN_ROLES et mot de passe hexadécimal : aucune donnée externe.
        await admin.unsafe(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);
        await admin.unsafe(`GRANT ${LOGIN_ROLES[login]} TO ${name}`);
        uris[login] = `postgres://${name}:${password}@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;
      }
    } finally {
      await admin.end();
    }

    return { adminUri, uris, stop: async () => { await container.stop(); } };
  } catch (e) {
    await container.stop();
    throw e;
  }
}
