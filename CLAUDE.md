# CLAUDE.md — Toron

## Le produit en dix lignes

Toron est un SaaS B2B français de conformité et de gestion des risques
(GRC) pour PME/ETI : ISO/IEC 27001:2022, NIS 2/ReCyF, RGPD, puis
ISO 9001:2015 (pack QMS) sur un **socle unique**. Proposition de valeur :
« Prouvez une fois. Couvrez tout. » — un contrôle, une preuve ou un
document peut satisfaire plusieurs référentiels ; le cross-mapping est
l'objet central du produit, pas une feature parmi d'autres.
Différenciateurs : EBIOS RM guidé, chronologie réglementaire NIS 2
(24 h / 72 h / J+30), exports PDF scellés « poinçon » (SHA-256 + page
publique de vérification), souveraineté UE, import Excel comme porte
d'entrée. Cible : RSSI, dirigeants, consultants. Langue produit : FR.

## Sources de vérité

- `docs/PLAN.md` — plan produit & technique complet : vision, décisions
  d'architecture (ADR), modèle de données, modules avec règles métier,
  roadmap, hors-scope. **À lire avant toute tâche.**
- `docs/toron-prompts-claude-design.md` — spécification des 16 écrans.
- `docs/design/` — maquettes HTML et identité (logos SVG). Référence
  visuelle uniquement : on **reconstruit** avec les tokens de
  `packages/ui`, on ne copie jamais le code des maquettes en production.

## Protocole de travail

- Une phase à la fois (PLAN.md §10) : M0 → MVP → V1 → V2 → V3. On ne
  commence pas une phase tant que la DoD de la précédente n'est pas verte.
- Un module par session (ex. « implémente le module 5.2 en phase MVP »).
- Ordre immuable dans un module : migration SQL + politiques RLS + tests
  d'isolation → règles métier dans `packages/core` (pures, testées) → UI.
- Toute idée ou demande hors phase va dans `docs/BACKLOG.md`, pas dans
  le code.
- Patch plutôt que réécriture. Pas de refactor opportuniste dans une PR
  de feature.

## Stack (détails et justifications : PLAN.md §3)

Next.js 15 (App Router) + TypeScript strict · PostgreSQL 16 + RLS managé
Scaleway · Drizzle **exclusivement via le wrapper `withTenant()`** ·
Better Auth (auth dans notre Postgres, TOTP) · Scaleway Object Storage
(URLs signées) · Scaleway TEM (e-mails) · pg-boss (jobs) · Typst
(livrables PDF scellés) · **souveraineté : aucun sous-traitant US** ·
monorepo pnpm : `apps/web` (application), `apps/site` (vitrine statique,
Cloudflare Pages), `packages/{db,core,ui,frameworks,typst}`, `workers/`,
`infra/`.

## Conventions (exécutoires — PLAN.md §13)

- TypeScript strict, pas de `any` non justifié. Zod à chaque frontière
  (API routes, server actions, imports, webhooks, variables d'env).
- Toute requête DB passe par `withTenant(tenantId, fn)` (transaction +
  `SET LOCAL app.tenant_id`). L'usage direct du client Drizzle hors
  wrapper est interdit.
- Chaque module livre : migration + politiques RLS + **tests d'isolation
  cross-tenant** + tests unitaires des règles métier + e2e Playwright du
  parcours principal. Les tests d'isolation sont un gate de merge.
- Les règles métier (scoring, mutualisation, échéances NIS 2, efficacité
  CAPA, séparation des tâches auditeur/audité) vivent dans
  `packages/core`, jamais dans les composants React.
- Erreurs : format `{ code, message, correlationId }`, message
  utilisateur en français avec cause + correction, jamais de stack trace
  au client, jamais d'échec silencieux.
- Jamais de secret, de PII ou de contenu de preuve dans les logs.
  Jamais de secret en dur — `.env` validé par schéma au démarrage,
  `.env*` dans `.gitignore`.
- Commits conventionnels, PRs petites. DoD d'une PR : lint + typecheck +
  tests verts, checklist OWASP du module cochée, migration réversible,
  seed démo à jour si le modèle change, capture d'écran si UI.
- Données de démo : tenant « Meridiane Logistics » (148 salariés,
  3 sites, périmètre SMSI + QMS), cohérent partout. Jamais de lorem ipsum.
- `packages/ui` est la seule source de tokens ; aucune couleur en dur.
- Jamais le texte intégral des normes ISO (copyright AFNOR) : identifiants
  de clauses + reformulations maison uniquement. ReCyF/ANSSI : public.

## Sécurité — rappels bloquants

- Aucun rôle Postgres BYPASSRLS au runtime ; rôle migrations séparé.
- RBAC contrôlé côté serveur ; l'UI ne fait que refléter.
- Fichiers uploadés : allowlist de types, taille max, hash SHA-256 à
  l'ingestion, URLs signées courtes, stockage hors racine web.
- En-têtes durcis (CSP stricte, HSTS), CSRF sur mutations, rate limiting
  sur l'auth et les endpoints publics, UUID partout (pas d'ID séquentiel).
- `audit_log` : INSERT only, aucune API d'effacement.

## Commandes

- `pnpm install` — installe tout le monorepo (Node ≥ 22, pnpm 11).
- `pnpm dev` — lance apps/web en développement (`--filter @toron/site dev`
  pour la vitrine, port 3001).
- `pnpm lint` · `pnpm typecheck` · `pnpm test` — les trois gates locaux.
  Toujours les lancer avant de conclure une tâche.
- `pnpm build` — build de tous les paquets.
- `docker compose -f infra/compose.yaml up --build` — app + Postgres 16
  en local (DoD M0).
- `DATABASE_URL_MIGRATIONS=… pnpm --filter @toron/db migrate` — applique
  les migrations SQL (rôle DDL, jamais le rôle applicatif).
- `DATABASE_URL_MIGRATIONS=… pnpm --filter @toron/db seed` — seed ReCyF
  v2.5 complet + tenant démo « Meridiane Logistics » (idempotent).
