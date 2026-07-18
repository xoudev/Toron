# Backlog — hors phase courante

Règle (PLAN.md §10) : toute idée ou demande qui ne relève pas de la phase
en cours est consignée ici, jamais dans le code. Chaque entrée : date,
description courte, phase cible pressentie.

## Entrées

- **2026-07-18 · pg-boss pour la file d'export (5.3c)** — Le worker Typst
  consomme la file via la table `exports` (statut `en_cours` →
  `en_traitement` → `scelle`/`echec`, réclamation atomique `FOR UPDATE SKIP
  LOCKED`). Solution suffisante pour le MVP (un worker, faible volume). Passer
  à pg-boss (ADR-8) quand il faudra planification, back-off/retries, jobs
  périodiques (fraîcheur des preuves, chronologie NIS 2) et plusieurs types de
  jobs. Phase cible : V1.
- **2026-07-18 · Rate limiting de la page publique /verifier (5.3c)** — La
  vérification publique du poinçon (`verify_export`, SECURITY DEFINER, champs
  sûrs uniquement) n'a pas encore de limite de débit ; à poser avec le rate
  limiting global des endpoints publics/auth (§8.1) au déploiement. Phase
  cible : MVP (déploiement staging).
- **2026-07-18 · e2e Playwright de l'export SoA scellé (5.3c)** — Lancer une
  campagne → « Exporter la Déclaration d'applicabilité » → attendre le scellé
  (worker) → télécharger le PDF → ouvrir /verifier/<slug> → comparer
  l'empreinte d'un fichier. Vérifié manuellement en Docker local ; l'e2e suit
  l'infra Playwright transverse. Phase cible : MVP.
- **2026-07-18 · e2e Playwright du parcours référentiels (5.2c)** — Connexion
  Camille (resp_qualite) → catalogue → ouvrir ISO 27001 → sélectionner A.8.5 →
  rattacher/retirer un contrôle → voir « mutualisé ». Vérifié manuellement en
  Docker local ; l'infra Playwright + job CI reste à poser (transverse, PR
  dédiée). Phase cible : MVP.
- **2026-07-18 · Écran référentiels — éléments d'évaluation (module 5.3)** —
  Les maquettes 01/02 montrent jauge de couverture %, écarts, statuts
  Conforme/Écart/N-A, panneau SoA (justification d'inclusion/exclusion),
  historique de statut, export Déclaration d'applicabilité, preuves +
  fraîcheur, « Lancer une évaluation ». Volontairement non construits en 5.2c
  (données absentes du socle). Phase cible : MVP (module 5.3).
- **2026-07-18 · Confiance de X-Forwarded-For derrière proxy** — L'IP source
  des entrées audit_log est validée (format) mais reste falsifiable tant que
  le hop injecté par le reverse proxy (Caddy, ADR-9) n'est pas le seul retenu.
  Fixer la stratégie « trusted proxy » au déploiement. Phase cible : MVP
  (déploiement staging).
- **2026-07-18 · Contraste AA des libellés mono en --text-3** — Les libellés
  de section en mono MAJUSCULES (~9-10px) restent en --text-3 (contraste sous
  AA). Les identifiants porteurs de données ont été passés en --text-2. Décider
  si ces labels décoratifs doivent aussi être assombris (ou --text-3 relevé
  globalement dans les tokens). Phase cible : V1 (passe accessibilité).
- **2026-07-18 · Ajout d'exigences aux référentiels custom (UI)** — L'action
  addCustomRequirementAction existe et est gardée (builtin immuable), mais
  l'UI d'ajout d'exigence dans un référentiel custom n'est pas encore posée
  (le référentiel custom se crée vide). Phase cible : MVP.
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
