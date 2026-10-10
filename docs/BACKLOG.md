# Backlog — hors phase courante

Règle (PLAN.md §10) : toute idée ou demande qui ne relève pas de la phase
en cours est consignée ici, jamais dans le code. Chaque entrée : date,
description courte, phase cible pressentie.

## Entrées

- **2026-10-06 · Responsables limités aux membres de l'organisation** —
  Les colonnes `owner_user_id` (risques, actions, fournisseurs, obligations,
  traitements…) référencent `users(id)` par une clé étrangère simple, qui
  ignore la RLS : un gestionnaire peut désigner l'UUID d'un utilisateur d'une
  autre organisation. Aucune fuite (la RLS de `users` masque le nom), mais
  l'intégrité n'est pas garantie. Vérifier l'appartenance côté serveur pour
  tous les modules, ou clé composite vers `memberships (user_id, tenant_id)`.
  Phase cible : V1 (durcissement transverse).

- **2026-10-06 · Questionnaire fournisseur rempli par le fournisseur (5.10)**
  — L'évaluation livrée en V1 est remplie par l'organisation à partir des
  pièces du fournisseur. Envoyer le même questionnaire au fournisseur
  (compte invité restreint, lien à durée de vie courte, relances, pièces
  jointes versées au coffre de preuves) relève du portail fournisseur.
  Phase cible : V2.

- **2026-10-06 · Retirer l'exception `minimumReleaseAgeExclude`** — Le
  correctif source-map-js 1.2.2 (GHSA-68fv-2mgg-jv7q) a été installé avant la
  fin du délai de 7 jours, par une exception limitée à cette version exacte
  dans `pnpm-workspace.yaml`. La retirer à la prochaine mise à jour des
  dépendances : le délai est écoulé depuis le 07/10. Phase cible : immédiate.

- **2026-07-19 · Rate limiting distribué (multi-instances)** — §8.1 pose un
  limiteur EN MÉMOIRE dans le middleware (par instance) sur `/api/auth/*` et
  `/verifier/*`. Suffisant en mono-nœud ; pour un déploiement multi-instances,
  passer à un limiteur partagé (Redis/Upstash) au moment du scale. Phase cible :
  V1 (déploiement).

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
  Mise à jour 2026-10-01 : traité pour le staging (`infra/staging/`), web
  n'est joignable qu'à travers Caddy, qui remplace tout X-Forwarded-For
  fourni par le client. À reconduire tel quel en production.
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
  Mise à jour 2026-10-01 : Vitest 4.1 adopté par anticipation pour corriger
  une faille (path traversal dans @vitest/mocker) ; Next reste en 15.5.
  Mise à jour 2026-10-01 : Next.js 16, Node.js 26 et PostgreSQL 18 adoptés.
  Restent à évaluer : TypeScript 7 et ESLint 10.
  Mise à jour 2026-10-01 : TypeScript 6, ESLint 10 et Vitest 5 adoptés.
  Reste à évaluer : TypeScript 7 (compilateur natif).
- **2026-10-01 · Image worker sans dépendances de dev** : `infra/worker.Dockerfile`
  exécute un `pnpm install` complet, l'image livrée embarque donc vitest,
  testcontainers, eslint, etc. Installer uniquement les dépendances de
  production du worker (surface d'attaque, taille, bruit des scans d'image).
  Valider par le job Docker de la CI. Phase cible : V1 (déploiement).
- **2026-10-01 · Typst 0.12.0 (octobre 2024)** : monter de version après
  vérification du rendu des templates scellés. Le binaire n'embarque pas de
  métadonnées de dépendances : ses crates sont invisibles des scanners d'image.
  Phase cible : V1.
- **2026-10-01 · DAST sur staging** : scan OWASP ZAP baseline (passif) de
  l'environnement de staging après chaque déploiement, règles bloquantes
  ciblées (CSP, cookies, en-têtes). Phase cible : MVP (staging).
- **2026-10-01 · Image Postgres des tests** : traité le 2026-10-01, constante
  unique `packages/db/src/test-image.ts` alignée sur les compose (18.6).
- **2026-10-07 · e2e Playwright du plan de traitement des risques** —
  Connexion Camille → registre des risques → risque « TRAITEMENT À
  PLANIFIER » → « Planifier une action » (responsable Antoine) → action
  visible dans le plan d'action, pastille « Risque ↗ » de retour → action
  terminée → « À RECOTER » → recotation → « Cible atteinte ». Vérifié
  manuellement le 2026-10-07 ; suit l'infra Playwright transverse. Phase
  cible : MVP.
- **2026-10-07 · Recherche : ligatures et synonymes** — Le pliage de la
  recherche ramène « œ » à « o » des deux côtés : « oeuvre » ne trouve donc
  pas « œuvre ». Traiter les ligatures (œ → oe, æ → ae) et, plus tard, des
  synonymes métier (PCA/PRA, MFA/2FA). Phase cible : V1.
- **2026-10-07 · e2e Playwright des dérogations** — Demande (contrôle
  choisi : règle pré-remplie) → refus sans motif bloqué → décision par un
  tiers (séparation des tâches) → notification du demandeur → renouvellement
  pré-rempli → clôture d'une dérogation échue. Vérifié manuellement le
  2026-10-07 ; suit l'infra Playwright transverse. Phase cible : MVP.
- **2026-10-07 · e2e Playwright des revues de contrôle** — Revue
  « partiellement efficace » avec preuve → action corrective ouverte pour le
  responsable, pastille « Contrôle ↗ » de retour → contrôle « À jour » ;
  changement de responsable notifié. Vérifié manuellement le 2026-10-07.
  Phase cible : MVP.
- **2026-10-07 · Dérogations et acceptation des risques** — Une dérogation
  accordée est une acceptation de risque résiduel : la rattacher au risque
  concerné, et signaler les dérogations renouvelées plus de deux fois
  (écart devenu permanent, à traiter autrement). Phase cible : V1.
- **2026-10-07 · Revue de contrôle avec preuve nouvelle** — Déposer la
  preuve de la revue (capture, export) depuis le formulaire de revue, au
  lieu de la choisir parmi les preuves déjà rattachées. Phase cible : V1.
- **2026-10-10 · Rattacher une preuve directement à une exigence** — Le
  modèle admet la liaison preuve → exigence (PLAN §5.7 : liaison n-n
  contrôles/exigences), mais le coffre ne propose que les contrôles : sans
  contrôle, une preuve déposée ne couvre rien. Ajouter dans la fiche de la
  preuve un choix d'exigences des référentiels activés (recherche par
  identifiant), à côté des contrôles. Phase cible : MVP (reliquat).
- **2026-10-07 · e2e Playwright de la sensibilisation** — Nouvelle session
  tenue (présents inférieurs aux membres cochés : refus) → dépôt de la
  feuille d'émargement depuis la fiche (coffre, antivirus) → indicateur
  « feuilles » à jour ; planification préremplie de la formation des
  dirigeants → saisie de la présence → dirigeant « À jour ». Vérifié
  manuellement le 2026-10-07. Phase cible : MVP.
- **2026-10-07 · Feuille d'émargement imprimable** — Générer pour une
  session planifiée une feuille d'émargement PDF (intitulé, date, public,
  intervenant, lignes de signature), à faire signer puis déposer au coffre.
  Phase cible : V1.
- **2026-10-07 · Rappel de la formation des dirigeants** — Notifier le
  dirigeant et le RSSI deux mois avant l'échéance de la formation (NIS 2,
  art. 20), comme les autres échéances du worker. Phase cible : V1.
- **2026-10-08 · e2e Playwright de la continuité** — Bilan d'impact mis à
  jour (responsable changé, notifié) → exercice planifié dans « Mon
  travail » du pilote → résultat « non atteint » sans enseignements :
  refus → reprise au-delà de la DMIA : objectif manqué, bandeau → action
  corrective P1 reliée au plan d'action → rapport déposé au coffre.
  Vérifié manuellement le 2026-10-08. Phase cible : MVP.
- **2026-10-08 · Bilan d'impact par horizon** — Coter l'impact (financier,
  opérationnel, réglementaire, image) à 4 h, 24 h, 72 h et une semaine,
  et proposer la DMIA qui en découle, au lieu de la saisir directement.
  Phase cible : V2.
- **2026-10-08 · Incidents et continuité** — Rattacher un incident aux
  activités critiques touchées et comparer la durée d'interruption réelle
  à leur DMIA (retour d'expérience pour la revue de direction). Phase
  cible : V2.
- **2026-10-08 · Vérification périodique du journal** — Faire vérifier le
  chaînage du journal d'audit chaque nuit par le worker et alerter le
  propriétaire et le RSSI à la première rupture, sans attendre qu'un
  membre lance la vérification. Phase cible : V2.
- **2026-10-08 · Ancrage externe de la tête de chaîne** — Inscrire la tête
  du journal (numéro, empreinte) dans chaque livrable scellé et la faire
  horodater par un prestataire qualifié eIDAS (RFC 3161), pour qu'une
  réécriture complète du journal par un administrateur de la base se voie
  aussi. Phase cible : V3.
- **2026-10-08 · Pièces jointes du portail fournisseur** — Permettre au
  fournisseur de déposer ses attestations (certificat, rapport de test
  d'intrusion, assurance) depuis le portail : type et taille bornés,
  empreinte, antivirus, puis rattachement en attestation par
  l'organisation à la validation. Phase cible : V2.
- **2026-10-08 · Envoi et relances des demandes par e-mail** — Envoyer le
  lien du portail au contact par e-mail (Scaleway TEM) et relancer avant
  l'échéance, au lieu de le transmettre à la main. Phase cible : V2.
- **2026-10-08 · e2e Playwright du portail fournisseur** — Demande créée
  depuis la fiche → brouillon sur le portail → envoi incomplet refusé →
  envoi → notification → examen et validation → lien clos. Vérifié
  manuellement le 2026-10-08. Phase cible : V2.
