import { DEMO, seedDemoTenant, seedFrameworkCatalog, seedIso27001Framework, seedRecyfFramework } from './seed.ts';

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
await seedIso27001Framework(url);
await seedFrameworkCatalog(url);
await seedDemoTenant(url);
console.warn(
  `Seed terminé : référentiels builtin ReCyF v2.5 (20 objectifs, 152 moyens) et ISO/IEC 27001:2022 (clauses 4-10 + 93 contrôles Annexe A), tenant démo « Meridiane Logistics » (/t/${DEMO.slug}).`,
);
console.warn(
  `Comptes de démo (local uniquement) : claire.morel@ / antoine.vasseur@ / camille.poirier@meridiane-logistics.example — mot de passe : ${DEMO.password}`,
);
