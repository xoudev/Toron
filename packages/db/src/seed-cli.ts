import { DEMO, seedDemoTenant, seedRecyfFramework } from './seed.js';

// Usage : DATABASE_URL_MIGRATIONS=postgres://… pnpm --filter @toron/db seed
// Rôle DDL/superutilisateur local uniquement (les builtins et la création
// de tenant sont volontairement hors de portée du rôle applicatif).
const url = process.env['DATABASE_URL_MIGRATIONS'];
if (!url) {
  console.error(
    'DATABASE_URL_MIGRATIONS manquante — définissez la chaîne de connexion du rôle migrations, puis relancez.',
  );
  process.exit(1);
}

await seedRecyfFramework(url);
await seedDemoTenant(url);
console.warn(
  `Seed terminé : référentiel ReCyF v2.5 (20 objectifs, 152 moyens) et tenant démo « Meridiane Logistics » (/t/${DEMO.slug}).`,
);
console.warn(
  `Comptes de démo (local uniquement) : claire.morel@ / antoine.vasseur@ / camille.poirier@meridiane-logistics.example — mot de passe : ${DEMO.password}`,
);
