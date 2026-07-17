# Backlog — hors phase courante

Règle (PLAN.md §10) : toute idée ou demande qui ne relève pas de la phase
en cours est consignée ici, jamais dans le code. Chaque entrée : date,
description courte, phase cible pressentie.

## Entrées

- **2026-07-17 · Seed en staging sans superutilisateur** — Les seeds M0-6
  (builtins + tenant démo) supposent un rôle DDL avec BYPASSRLS implicite
  (superutilisateur local). Sur Postgres managé Scaleway, prévoir un rôle
  seed dédié ou des politiques d'amorçage. Phase cible : MVP (déploiement
  staging).
- **2026-07-17 · e2e Playwright du parcours auth** — Inscription →
  connexion → 2FA → création d'organisation → accès tenant. À livrer avec
  les premiers écrans MVP (module 5.1/5.2), l'infra e2e n'existant pas
  encore. Phase cible : MVP.
- **2026-07-17 · CSP stricte avec nonce** — Le script inline d'init du
  thème (layout) devra porter un nonce quand les en-têtes durcis (§8.1)
  seront posés. Phase cible : MVP.
- **2026-07-16 · Montées de version outillage** — L'écosystème a avancé
  au-delà des versions épinglées par les ADR : Next.js 16, TypeScript 7
  (compilateur natif), ESLint 10, Vitest 4 sont disponibles. Le monorepo
  reste volontairement sur Next 15 (ADR-1) / TS 5.9 / ESLint 9 / Vitest 3.
  Évaluer la migration groupée une fois le MVP stabilisé. Phase cible : V1.
