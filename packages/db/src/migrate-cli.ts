import { applyMigrations } from './migrate.js';

// Usage : DATABASE_URL_MIGRATIONS=postgres://… pnpm --filter @toron/db migrate
// Le rôle de connexion doit être le rôle DDL, pas le rôle applicatif (S5).
const url = process.env['DATABASE_URL_MIGRATIONS'];
if (!url) {
  console.error(
    'DATABASE_URL_MIGRATIONS manquante — définissez la chaîne de connexion du rôle migrations, puis relancez.',
  );
  process.exit(1);
}

const applied = await applyMigrations(url);
console.warn(
  applied.length > 0
    ? `Migrations appliquées : ${applied.join(', ')}`
    : 'Aucune migration à appliquer — schéma à jour.',
);
