# TORON — Plan produit & technique v1.0

Document de référence pour le développement. Destiné à être lu par des humains
et par Claude Code. Toute décision non couverte ici se tranche par les
principes de la section 2.

---

## 0 · Comment utiliser ce document avec Claude Code

1. Placer ce fichier à la racine du repo : `docs/PLAN.md`.
2. Créer un `CLAUDE.md` à la racine contenant : un résumé de 10 lignes du
   produit, un renvoi vers `docs/PLAN.md`, et la section 13 (conventions)
   copiée intégralement.
3. Travailler **phase par phase** (section 10), **module par module**.
   Ne jamais demander « implémente le plan » — demander « implémente le
   module 5.2 en phase MVP, migrations + RLS + tests d'abord ».
4. Chaque module commence par : migration SQL + politiques RLS + tests
   d'isolation, puis la logique métier, puis l'UI.
5. Les 16 écrans sont spécifiés dans `docs/toron-prompts-claude-design.md`
   (déjà rédigé) ; la correspondance module ↔ écran est en section 9.

---

## 1 · Vision & positionnement

**Toron** est une plateforme SaaS B2B française de conformité et de gestion
des risques pour PME/ETI (50–500 salariés) et leurs RSSI/consultants.
Un **socle unique** (IMS, structure harmonisée Annexe SL) porte des **packs
de référentiels** : ISO/IEC 27001:2022, NIS 2/ReCyF, RGPD, puis ISO 9001:2015
(pack QMS), et plus tard DORA/14001.

**Proposition de valeur** : « Prouvez une fois. Couvrez tout. » — un contrôle,
une preuve, un document peuvent satisfaire plusieurs référentiels via le
cross-mapping. La mutualisation est l'objet central du produit, pas une
feature parmi d'autres.

**Différenciateurs** : EBIOS RM natif et guidé (personne ne le fait en
lite) ; chronologie réglementaire NIS 2 opérationnelle (24 h / 72 h / J+30) ;
exports scellés au poinçon (SHA-256 + URL de vérification) ; souveraineté
(hébergement UE, données exportables, français d'abord) ; import Excel
comme porte d'entrée.

**Anti-vision** : Toron n'est pas une suite GRC entreprise, pas un scanner,
pas un LMS, pas un outil de production qualité réglementée. Voir section 11.

---

## 2 · Principes non négociables

**Produit**
- P1. Le socle avant les packs : tout objet métier (exigence, contrôle,
  preuve, action, document) est conçu multi-référentiels dès sa naissance.
- P2. Un seul moteur d'actions pour toutes les origines (risque, écart,
  incident, NC, évaluation, revue). Pas de duplication CAPA / remédiation.
- P3. Le livrable fait foi : tout ce qui sort (SoA, rapport, PV, registre)
  doit être présentable tel quel à un auditeur. Qualité documentaire = cœur.
- P4. Jamais le texte intégral des normes ISO (copyright AFNOR). Uniquement
  des identifiants de clauses + reformulations maison. ReCyF/ANSSI : public.
- P5. Import facile, export total. Aucun verrouillage des données client.

**Sécurité (Secure by Design — s'applique à chaque PR)**
- S1. Multi-tenant : isolation par RLS PostgreSQL, testée en CI. Aucune
  requête applicative sans contexte tenant. Aucun rôle BYPASSRLS au runtime.
- S2. Validation stricte des entrées (Zod) à chaque frontière : API routes,
  server actions, imports de fichiers, webhooks.
- S3. Aucun secret en dur. Variables d'environnement validées au démarrage
  (schéma Zod de config) ; gestionnaire de secrets côté hébergeur.
- S4. Erreurs : jamais de stack trace au client, jamais d'échec silencieux.
  Format d'erreur standard { code, message, correlationId }, log serveur
  structuré.
- S5. Moindre privilège partout : rôles DB séparés (app / migrations),
  RBAC applicatif par module, séparation des tâches (un auditeur ne peut
  pas éditer ce qu'il audite).
- S6. Journal d'audit immuable (append-only) de toute action significative.
- S7. Dépendances : populaires et maintenues ; crypto = primitives standard
  (WebCrypto/node:crypto), jamais de crypto maison.

---

## 3 · Architecture technique

### 3.1 Décisions (format ADR court)

**ADR-1 · Stack applicative : Next.js 15 (App Router) + TypeScript strict.**
Justification : vélocité maximale (stack déjà maîtrisée sur CyberLearn),
SSR pour un outil métier dense, écosystème mature. Monolithe modulaire —
pas de microservices.

**ADR-2 · Données : PostgreSQL 16 + RLS managé Scaleway, ORM Drizzle.**
Postgres est l'invariant du projet. Souveraineté intégrale dès le jour un :
Postgres managé **Scaleway** (sauvegardes + PITR inclus) et **Scaleway
Object Storage** (S3, URLs signées courtes) pour les fichiers de preuves
et de documents. Aucun sous-traitant américain dans le DPA — argument
commercial autant que technique (CLOUD Act). ORM : **Drizzle** — proche
du SQL, sans binaire moteur, migrations en SQL lisible, intégration
naturelle du pattern RLS `SET LOCAL`. Règle de portabilité inchangée :
rien de propriétaire, `pg_dump` doit suffire à partir.

**ADR-3 · Isolation tenant : RLS par variable de session.**
Pattern unique dans tout le code :
- Toute table métier porte `tenant_id uuid NOT NULL`.
- Politique type : `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- Accès Drizzle exclusivement via un wrapper `withTenant(tenantId, fn)` qui
  ouvre une transaction et exécute `SET LOCAL app.tenant_id = $1` après
  vérification de l'appartenance (session → membership).
- Le rôle Postgres applicatif n'a pas BYPASSRLS ; les migrations utilisent
  un rôle distinct.
- Tests d'isolation obligatoires en CI : lecture et écriture cross-tenant
  avec IDs forgés doivent échouer. C'est un gate de merge, pas une option.

**ADR-4 · AuthN : Better Auth, auto-hébergée dans notre Postgres.**
E-mail + mot de passe (argon2id) + TOTP obligatoire pour les rôles
Admin/RSSI dès le MVP ; organisations et invitations via les plugins
Better Auth. Aucune dépendance à un service d'authentification tiers.
SSO SAML/OIDC en V2 (demande entreprise). Sessions httpOnly,
SameSite=Lax, rotation à l'élévation de privilège.

**ADR-5 · Génération documentaire : Typst.**
Tous les exports PDF (SoA, registres, rapports d'audit, PV, livrables
EBIOS) sont compilés par Typst côté serveur (CLI dans un worker) à partir
de templates versionnés dans le repo. Justification : rendu déterministe,
rapide, qualité typographique — le livrable est un argument de vente (P3).
Fallback interdit : pas de « print to PDF » navigateur pour les livrables.

**ADR-6 · Sceau (le poinçon) : SHA-256 + endpoint de vérification.**
À chaque export : hash SHA-256 du PDF final, enregistrement
`exports(id, type, sha256, sealed_at, verify_slug)`, hash + slug imprimés
dans le pied de page du document (template Typst), page publique
`/verifier/[slug]` qui affiche type, date, empreinte et permet de comparer
avec un fichier déposé (hash calculé côté client, le fichier ne quitte pas
le navigateur). Chaînage de hash (type journal) : option V2, pas MVP.

**ADR-7 · Jobs asynchrones : pg-boss** (file d'attente sur Postgres).
Pas de Redis au départ — moins de pièces mobiles. Usages : compilation
Typst, envois d'e-mails, relances/escalades, calculs de fraîcheur,
imports Excel volumineux.

**ADR-8 · E-mails transactionnels : Scaleway TEM** (même fournisseur que
l'hébergement — un sous-traitant de moins au DPA), Brevo en alternative
française. Interface d'abstraction `Mailer` conservée pour rester
réversible. Cohérence souveraine : pas d'acteur US, y compris ici.

**ADR-9 · Environnements.**
- Vitrine (`apps/site`, export statique Next.js) : Cloudflare Pages (gratuit).
- Staging + Production : conteneurs Docker (Next standalone + worker) sur
  instance UE (Scaleway/Hetzner) derrière Caddy (TLS auto), Postgres managé,
  sauvegardes automatiques + test de restauration trimestriel (on applique
  à Toron ce que Toron vend).
- CI/CD : GitHub Actions → build, lint, typecheck, tests, SAST (semgrep),
  secrets scan (gitleaks), audit dépendances, build image → GHCR → deploy.
- Proxmox perso : dev/staging jetable uniquement, jamais de données client.

### 3.2 Structure du monorepo

```
toron/
├── CLAUDE.md
├── docs/            # PLAN.md, prompts écrans, ADRs additionnels
├── apps/
│   ├── web/         # Next.js 15 (App Router) — l'application (app.toron.eu)
│   └── site/        # Next.js 15 en export statique — vitrine + blog
│                    #   (toron.eu, déployé sur Cloudflare Pages)
├── packages/
│   ├── db/          # schéma Drizzle, migrations SQL, politiques RLS, seeds
│   ├── core/        # logique métier pure (scoring, mutualisation, règles)
│   ├── ui/          # design system (tokens, composants Plex/orange)
│   ├── frameworks/  # référentiels en données (JSON) : ReCyF, 27001*, 9001*
│   └── typst/       # templates de livrables + service de compilation
├── workers/         # pg-boss : exports, mails, relances, imports
└── infra/           # Dockerfiles, compose, Caddy, scripts déploiement
```
(*) reformulations maison uniquement — voir section 12.

Dockerfiles : multi-stage, versions épinglées (pas de `:latest`),
utilisateur non-root, image distroless ou alpine durcie.

---

## 4 · Modèle de données — le socle

Conventions : toutes les tables métier portent `id uuid pk`,
`tenant_id uuid not null`, `created_at`, `updated_at`, RLS activée.
Les énumérations sont des types Postgres. Ce qui suit décrit les entités
et leurs champs structurants ; le DDL exact est produit par migration.

### 4.1 Organisation & accès

- `tenants` (name, plan, region)
- `legal_entities` (tenant, name, siren?) · `sites` (entity, name, address)
- `users` (email unique, password_hash argon2id, totp_secret?, locale)
- `memberships` (user, tenant, role) — rôle ∈ {owner, direction, rssi,
  resp_qualite, pilote, auditeur, contributeur, lecteur}
- `scopes` (name, kind ∈ {smsi, qms, mixte}, entities[], sites[]) —
  les périmètres de management ; presque tout objet métier référence un scope.
- `audit_log` (at, actor_user, action, object_type, object_id,
  before jsonb, after jsonb, ip, user_agent) — **INSERT only** : aucun
  droit UPDATE/DELETE pour le rôle applicatif, trigger de protection.

### 4.2 Moteur de référentiels (le cœur)

- `frameworks` (code ∈ {iso27001_2022, recyf_v2_5, rgpd, iso9001_2015, …},
  version, source ∈ {builtin, custom}, active_per_scope)
- `requirements` (framework, ref_id « A.5.19 » / « OBJ-08 » / « §8.7 »,
  parent_id → arbre, title_internal, guidance_internal, applicable_default)
  — contenu = reformulation maison (P4).
- `controls` (title, description, owner_user, review_frequency, status)
  — les contrôles internes du client, objets à lui.
- `control_requirements` (control ↔ requirement, n-n) —
  **la table de mutualisation**. Une vue matérialisée
  `mutualized_controls` compte les contrôles couvrant ≥ 2 frameworks
  (alimente le « fil » du dashboard).
- `assessments` (framework, scope, campaign_label, status, started/closed)
- `assessment_items` (assessment, requirement, status ∈ {conforme, ecart,
  non_applicable, a_evaluer}, statement, soa_included bool,
  soa_justification — **obligatoire si non_applicable**, assessed_by, at)

### 4.3 Risques & EBIOS RM

- `risks` (scope, title, business_value, asset_ref?, scenario,
  source ∈ {manual, ebios}, gross_g int, gross_v int, treatment ∈ {reduire,
  transferer, accepter, eviter}, net_g, net_v, residual_target,
  owner_user, next_review)
- `risk_acceptances` (risk, accepted_by_user, accepted_at, rationale,
  expires_at) — l'acceptation est un objet de première classe, signée.
- `risk_controls` (risk ↔ control) · `risk_history` (cotations horodatées)
- V1 — EBIOS : `ebios_studies` (scope, status atelier 1–5),
  `risk_sources` (source, objectif visé), `feared_events` (valeur métier,
  gravité), `strategic_scenarios`, `operational_scenarios`
  (kill_chain jsonb : phases + techniques ATT&CK « T1566 »…, vraisemblance).

### 4.4 Plan d'action unifié (P2)

- `actions` (title, description, origin_type ∈ {risk, finding, incident,
  nc, assessment, review, manual}, origin_id, owner_user, due_date,
  priority ∈ {p1,p2,p3}, effort?, status ∈ {planifie, en_cours, en_retard,
  termine, verification})
- `action_links` (action ↔ requirement | control) · `action_subtasks` ·
  `action_comments` · relances via jobs (J-7, J, escalade J+7).

### 4.5 Documents & preuves

- `documents` (type ∈ {pssi, politique, procedure, charte, pca_pra,
  fiche_processus, autre}, title, scope, owner, review_due)
- `document_versions` (document, semver, file_ref, status ∈ {brouillon,
  relecture, approuve, publie}, approvals jsonb horodaté)
- `read_receipts` (document_version, user, signed_at) — accusés de lecture.
- `evidences` (title, type ∈ {capture, export, attestation, rapport, pv},
  file_ref, sha256, collected_at, valid_until, recurrence ∈ {ponctuelle,
  trimestrielle, semestrielle, annuelle}, collector_user)
- `evidence_links` (evidence ↔ control | requirement) — une preuve sert
  N référentiels : deuxième pilier de la mutualisation.
- Fraîcheur calculée : à_jour / expire_bientot (≤30 j) / expiree — job
  quotidien + notification.

### 4.6 Audits & revue de direction

- `audit_plans` (année, entrées du programme) · `audits` (scope, framework,
  auditor_user, planned_at, status)
- `findings` (audit, requirement, type ∈ {ecart_majeur, ecart_mineur,
  observation, point_fort}, description, evidence_ref?) — conversion
  1-clic en action (origin_type=finding).
- Contrainte métier S5 : `audits.auditor_user` ≠ owner des contrôles du
  périmètre audité (vérifié à l'affectation).
- `management_reviews` (scope(s), date, inputs_snapshot jsonb — entrées 9.3
  gelées au moment de la revue, participants, minutes) ; décisions →
  actions (origin_type=review).

### 4.7 Tiers, incidents, QMS

- `suppliers` (name, tier ∈ {t1,t2,t3}, services, data_categories[],
  contract_clauses_status) · `supplier_assessments` (campagne,
  questionnaire jsonb, sent_at, responded_at, score) ·
  `supplier_documents` (attestations, valid_until)
- `incidents` (severity, status, opened_at, nis2_important bool,
  nis2_criteria jsonb, gdpr_breach bool) ·
  `incident_events` (append-only : timeline horodatée) ·
  `incident_notifications` (kind ∈ {alerte_24h, notification_72h,
  rapport_30j, cnil_72h}, due_at, sent_at, export_ref) — les échéances
  sont calculées à la qualification, jobs de rappel.
- QMS (V2) : `processes` (lane ∈ {management, realisation, support},
  pilot, sipoc jsonb, indicators jsonb) ·
  `nonconformities` (source ∈ {interne, fournisseur, reclamation_client},
  gravity, cost_estimate, immediate_action, root_cause jsonb (5 pourquoi),
  status ∈ {ouverte, en_traitement, cloturee_a_verifier, efficace,
  rouverte}, effectiveness_check_at) — la vérification d'efficacité
  différée (J+90 par défaut) est une règle moteur, pas une convention.

### 4.8 Transverse

- `exports` (type, object_ref, file_ref, sha256, sealed_at, verify_slug
  unique) — le poinçon (ADR-6).
- `notifications` (user, kind, payload, read_at) ·
  `saved_filters` (user, screen, query jsonb) ·
  `imports` (kind, file_ref, mapping jsonb, report jsonb — lignes
  rejetées avec cause exacte).

---

## 5 · Fonctionnalités — SOCLE COMMUN

Chaque module : objectif, règles métier (RM), critères d'acceptation (CA),
phase. Les écrans correspondants sont en section 9.

### 5.1 Organisation, périmètres, rôles — **Phase M0**
Multi-entités/sites, périmètres SMSI/QMS, invitations par e-mail, rôles
fixes avec matrice de permissions par module.
RM : un utilisateur peut appartenir à plusieurs tenants ; le contexte
tenant est explicite dans l'URL (`/t/[slug]/…`) et vérifié serveur.
CA : tests d'isolation cross-tenant verts ; un Lecteur ne voit aucune
action d'écriture dans l'UI et reçoit 403 en API.

### 5.2 Moteur de référentiels & cross-mapping — **Phase MVP**
Chargement des frameworks comme données (`packages/frameworks`), arbre
d'exigences, contrôles internes, mapping contrôle↔exigences n-n,
référentiels custom (exigences internes/groupe).
RM : supprimer un contrôle mappé exige confirmation listant les exigences
découvertes ; la vue mutualisation compte les contrôles multi-frameworks.
CA : seeds ReCyF v2.5 complet + ISO 27001 (clauses 4–10 + Annexe A,
reformulé) ; créer un contrôle, le mapper à A.5.19 et OBJ-xx, le voir
apparaître « mutualisé » sur le dashboard.

### 5.3 Évaluations, gap analysis & SoA — **Phase MVP**
Campagnes d'évaluation par framework/scope, statut par exigence,
justifications, score de couverture, historisation des campagnes,
génération de la Déclaration d'applicabilité.
RM : `non_applicable` sans justification = enregistrement refusé (S2) ;
le score n'inclut jamais les N/A ; une exigence satisfaite par un contrôle
mutualisé hérite du statut sur les deux frameworks avec traçabilité.
CA : export SoA PDF Typst scellé, présentable à un auditeur.

### 5.4 Moteur de risques — **Phase MVP** · EBIOS RM guidé — **Phase V1**
Registre complet (brut/net/résiduel, options de traitement, propriétaire,
revues), matrice 4×4 configurable, acceptation formelle signée,
historique des cotations. V1 : les 5 ateliers EBIOS RM guidés, scénarios
opérationnels en kill chain ATT&CK, export livrable format ANSSI.
RM : traitement `accepter` sans `risk_acceptance` signée = risque affiché
« acceptation en attente » et remonté en revue de direction ; les échelles
G/V sont par tenant mais versionnées (changer d'échelle n'altère pas
l'historique).
CA : matrice filtrante ; un risque accepté affiche signataire + date +
échéance de revalidation.

### 5.5 Plan d'action unifié — **Phase MVP**
Table + kanban, origines multiples, sous-tâches, commentaires, relances
automatiques, filtres sauvegardés, actions groupées avec justification.
RM : toute conversion (constat, NC, décision de revue) pré-lie l'origine
et les exigences ; le passage en retard est calculé, jamais saisi ;
clôture d'une action d'origine NC → déclenche le flux de vérification
d'efficacité de la NC (V2).
CA : créer une action depuis un écart d'évaluation en 1 clic ; recevoir
la relance J-7 (job pg-boss, e-mail).

### 5.6 Gestion documentaire — **MVP light · V1 complet**
MVP : upload versionné, types, statut simple, date de revue + alertes.
V1 : workflow brouillon→relecture→approuvé→publié, approbations tracées,
accusés de lecture avec campagne de relance, diff des versions,
bibliothèque de modèles (PSSI, procédures — alignés ReCyF).
RM : un document « publié » est immuable (nouvelle version obligatoire) ;
les exigences couvertes par un document apparaissent dans la SoA.

### 5.7 Coffre de preuves — **Phase MVP**
Upload (types restreints, taille max, hash SHA-256 à l'ingestion),
liaison n-n contrôles/exigences, fraîcheur, tâches de collecte
récurrentes, tri « expirées d'abord », journal des accès.
RM : une preuve expirée dégrade visuellement (pas automatiquement en
statut) les exigences qu'elle couvre — l'humain décide, l'outil signale.
CA : une preuve liée à un contrôle mutualisé apparaît sur 27001 ET ReCyF.
V1 : antivirus (ClamAV) à l'ingestion. V3 : connecteurs de collecte auto.

### 5.8 Audits internes — **Phase V1**
Programme pluriannuel, checklist générée du référentiel, constats typés,
conversion constat→action, rapport scellé, package de preuves pour
l'organisme certificateur.
RM : séparation des tâches (S5) vérifiée à l'affectation de l'auditeur.

### 5.9 Revue de direction — **Phase V1**
Ordre du jour 9.3 auto-généré (commun 27001/9001 : une revue, deux
systèmes), entrées injectées et **gelées** en snapshot à la date de la
revue, décisions→actions, PV scellé, émargement.

### 5.10 Tiers & fournisseurs — **Phase V1**
Registre avec tiering, clauses contractuelles, campagnes de
questionnaires (envoi, relances, scoring), attestations avec validité,
demandes d'actions correctives fournisseur.
V2 : portail de réponse fournisseur (compte invité restreint) — première
brique de l'angle « effet cascade ».

### 5.11 Indicateurs & tableaux de bord — **Phase MVP (v1 simple)**
Dashboard par rôle : conformité pondérée, couverture par référentiel,
matrice, actions en retard, fraîcheur des preuves, échéances. Export
rapport direction PDF/board-ready (V1).
RM : chaque KPI est cliquable vers la donnée source (pas de chiffre
orphelin).

### 5.12 Notifications & workflows — **Phase MVP (e-mail) · V1 (in-app)**
E-mails transactionnels (invitation, relances, expirations, échéances
NIS 2), centre de notifications in-app, préférences par utilisateur.

### 5.13 Import Excel & export de données — **Phase MVP**
Wizard 4 étapes (dépôt, mapping avec détection, résolution ligne à ligne
avec cause exacte, confirmation) pour risques/actions/actifs/fournisseurs.
Export complet du tenant (JSON + fichiers) — anti-verrouillage (P5).
RM : jamais d'échec silencieux ; chaque ligne rejetée porte sa cause et
sa correction proposée (S4).

---

## 6 · Fonctionnalités — PACK GRC / SÉCURITÉ

### 6.1 Incidents & chronologie réglementaire — **Phase V1**
Registre, sévérités, timeline append-only, qualification « incident
important NIS 2 » par checklist de critères, échéancier automatique
alerte 24 h → notification 72 h → rapport J+30 avec comptes à rebours et
rappels, génération de la déclaration ANSSI pré-remplie (export scellé),
volet parallèle violation RGPD (échéance CNIL 72 h), REX à la clôture.
RM : les échéances se calculent à l'horodatage de qualification, pas
d'ouverture ; la timeline est immuable ; clôture impossible sans REX
si l'incident est qualifié important.

### 6.2 Continuité d'activité — **Phase V2**
BIA (RTO/RPO par processus), PCA/PRA comme documents versionnés,
planification et suivi des tests/exercices, enseignements → actions.

### 6.3 Actifs & cartographie — **MVP minimal · V1 enrichi**
MVP : inventaire simple (matériel/logiciel/données/flux) avec import CSV,
cotation DICP, lien actif↔risque. V1 : classification des données,
liens incidents. Jamais de CMDB maison : intégrations (GLPI/Intune) en V3.

### 6.4 Registre des obligations & enregistrement — **Phase V1**
Obligations applicables par entité (NIS 2 EE/EI, RGPD, sectoriel), suivi
de l'enregistrement MonEspaceNIS2, échéances réglementaires.
RGPD : registre des traitements simple (article 30). L'AIPD complète est
hors scope (section 11).

### 6.5 Vulnérabilités — **Phase V3, intégration uniquement**
Import de résultats de scan (CSV/API), suivi des SLA de remédiation via
le moteur d'actions, lien Jira. On ne construit pas de scanner.

---

## 7 · Fonctionnalités — PACK QMS (ISO 9001) — **Phase V2**

### 7.1 Processus
Cartographie management/réalisation/support, fiches SIPOC, pilotes,
indicateurs avec cibles, interactions, versionnage/approbation via le
module documentaire (réutilisation du socle, zéro code dupliqué).

### 7.2 Non-conformités & CAPA
Registre (interne/fournisseur/réclamation client), action immédiate,
analyse cause racine (5 pourquoi structuré, Ishikawa en option), actions
correctives via le moteur commun, coûts de non-qualité.
RM : clôture → statut `cloturee_a_verifier` + tâche de vérification
d'efficacité à J+90 (paramétrable) → `efficace` ou réouverture
automatique. Cette règle vit dans `packages/core`, testée unitairement.

### 7.3 Satisfaction client
Enquêtes simples (NPS/CSAT), tendance des réclamations, revue des
exigences client. Pas d'outil d'enquête avancé : le minimum utile 9001.

---

## 8 · Transverse produit

### 8.1 Sécurité de la plateforme — exigences détaillées
- AuthN : argon2id, TOTP (obligatoire Admin/RSSI), verrouillage progressif,
  réinitialisation par lien à usage unique et courte durée.
- Sessions : cookies httpOnly Secure SameSite=Lax, invalidation à la
  déconnexion et au changement de mot de passe.
- AuthZ : RBAC par module + règles métier (séparation des tâches) dans
  `packages/core` ; contrôle serveur systématique, l'UI ne fait que
  refléter.
- Web : en-têtes durcis (CSP stricte sans inline, HSTS, X-Content-Type-
  Options, Referrer-Policy), CSRF sur mutations, rate limiting sur auth
  et endpoints publics (`/verifier`), pas d'IDs séquentiels exposés (uuid).
- Fichiers : allowlist de types + taille max, stockage hors racine web,
  URLs signées à durée courte, hash à l'ingestion, AV en V1.
- OWASP Top 10 : revue explicite à chaque module (checklist PR).
- Chiffrement : TLS partout, chiffrement au repos (fournisseur), secrets
  applicatifs via env/secret manager (S3).
- Sauvegardes : quotidiennes + PITR (fournisseur), **test de restauration
  trimestriel documenté** — Toron doit passer son propre questionnaire
  fournisseur.

### 8.2 Journal d'audit immuable
Toute création/modification/suppression d'objet métier, connexion, export,
changement de rôle → `audit_log`. Consultable (écran 14), filtrable,
exportable. Aucune API d'effacement. Rétention paramétrable ≥ 1 an.

### 8.3 i18n, accessibilité, performances
FR d'abord, EN en V2 (structure i18n dès M0 pour ne pas retrofitter).
Accessibilité : focus visible, navigation clavier des tables, contrastes
AA, `prefers-reduced-motion`. Perf : tables virtualisées au-delà de
200 lignes, pagination serveur par défaut.

### 8.4 IA — **Phase V3, souveraine ou rien**
Aide à la rédaction (politiques, justifications SoA), suggestions de
mapping contrôle↔exigence, pré-réponse aux questionnaires fournisseurs
depuis le corpus de preuves. Contraintes : inférence hébergée UE, zéro
entraînement sur données client, opt-in par tenant, mention explicite.
Aucune décision de conformité automatisée : l'IA propose, l'humain statue.

---

## 9 · Correspondance modules ↔ écrans

Les specs d'écrans sont dans `docs/toron-prompts-claude-design.md`.

| Écran | Module(s) | Phase |
|---|---|---|
| Dashboard (existant) | 5.11 | MVP |
| 01 Catalogue référentiels | 5.2 | MVP |
| 02 Détail référentiel + SoA | 5.2, 5.3 | MVP |
| 03 Plan d'action | 5.5 | MVP |
| 04 Registre des risques | 5.4 | MVP |
| 05 Atelier EBIOS RM | 5.4 | V1 |
| 06 Incidents | 6.1 | V1 |
| 07 Documents | 5.6 | MVP light / V1 |
| 08 Coffre de preuves | 5.7 | MVP |
| 09 Audits | 5.8 | V1 |
| 10 Fournisseurs | 5.10 | V1 |
| 11 Revue de direction | 5.9 | V1 |
| 12 Processus | 7.1 | V2 |
| 13 Non-conformités | 7.2 | V2 |
| 14 Paramètres & admin | 5.1, 8.2 | M0→ |
| 15 Import Excel | 5.13 | MVP |
| 16 Landing | — | avec MVP |

---

## 10 · Roadmap & jalons

### M0 — Fondations (avant toute feature)
Monorepo + CI complète (lint, typecheck, tests, semgrep, gitleaks, audit
deps) · schéma socle 4.1/4.2 partiel + RLS + **tests d'isolation** ·
auth + TOTP · tenants/rôles/périmètres · audit_log · design tokens +
shell UI (sidebar/topbar de la maquette) · seed framework ReCyF complet.
**DoD M0 : un second tenant ne peut rien lire du premier, prouvé par la
suite de tests ; l'app tourne en Docker local.**

### MVP — le produit démontrable et vendable à des design partners
Modules : 5.2, 5.3, 5.4 (registre manuel), 5.5, 5.6 light, 5.7, 5.11 v1,
5.12 e-mail, 5.13, 6.3 minimal · exports Typst scellés (SoA + registre
des risques) + page /verifier · écrans 01–04, 07–08, 14–15 + landing.
**DoD MVP : le tenant démo « Meridiane Logistics » est complet et
cohérent ; parcours import Excel → évaluation ReCyF → écarts → actions →
export SoA scellé réalisable en démo live de 15 minutes ; déployé sur
staging UE ; sauvegarde restaurée une fois avec succès.**

### V1 — la crédibilité RSSI
EBIOS RM guidé (5.4) · incidents NIS 2 (6.1) · audits (5.8) · revue de
direction (5.9) · fournisseurs (5.10) · workflow documentaire complet +
accusés (5.6) · registre obligations (6.4) · notifications in-app ·
rapport direction · ClamAV.

### V2 — le pack QMS + l'entreprise
Processus, NC/CAPA avec vérification d'efficacité, satisfaction (7.x) ·
SSO SAML/OIDC · API publique + webhooks · portail fournisseur ·
continuité (6.2) · EN · chaînage du journal (option).

### V3 — l'expansion
Connecteurs de preuves (M365/Entra/AWS) · IA souveraine (8.4) · mode
« je suis fournisseur » complet · DORA / ISO 14001 · intégrations
GLPI/Intune/Jira.

Règle de pilotage : on ne commence pas une phase tant que la DoD de la
précédente n'est pas verte. Les demandes hors phase vont dans
`docs/BACKLOG.md`, pas dans le code.

---

## 11 · Hors-scope explicite (on ne construit PAS)

Scanner de vulnérabilités · LMS/plateforme de formation (intégration
seulement) · simulation de phishing · AIPD/module DPO complet · QMS de
production réglementée (plans de contrôle, 21 CFR Part 11, métrologie
avancée) · CMDB · application mobile · marketplace de consultants ·
signature électronique qualifiée eIDAS (le poinçon est un sceau
d'intégrité, pas une signature qualifiée — le dire honnêtement dans le
produit).

---

## 12 · Contraintes légales & conformité de Toron elle-même

- **Copyright AFNOR/ISO (P4)** : les seeds 27001/9001 contiennent
  identifiants de clauses + intitulés et guidances reformulés. Jamais le
  texte normatif. ReCyF et publications ANSSI : librement utilisables.
  Revue de ce point avant toute publication de seed.
- **RGPD de Toron** : registre de ses propres traitements dès le premier
  client ; DPA (accord de sous-traitance art. 28) à fournir ; politique de
  confidentialité ; durées de rétention ; sous-traitants listés (hébergeur,
  e-mail). Prévoir la question au premier questionnaire fournisseur reçu.
- **CGU/CGV + limitation de responsabilité** : Toron outille la conformité,
  il ne la garantit pas — formulation à faire valider juridiquement avant
  la première vente. Assurance RC pro à souscrire au premier contrat.

---

## 13 · Conventions de développement (à copier dans CLAUDE.md)

- TypeScript strict, pas de `any` non justifié. Zod à chaque frontière.
- Toute requête DB passe par `withTenant()` ; l'usage direct du client
  Drizzle hors wrapper est interdit et vérifié par lint rule.
- Chaque module livre : migration + politiques RLS + tests d'isolation +
  tests unitaires des règles métier (`packages/core`) + tests e2e du
  parcours principal (Playwright).
- Les règles métier (scoring, mutualisation, échéances NIS 2, efficacité
  CAPA, séparation des tâches) vivent dans `packages/core`, pures et
  testées — jamais dans les composants React.
- Erreurs : format standard, correlationId loggé, message utilisateur en
  français, cause + correction (jamais « une erreur est survenue »).
- Jamais de secret, de PII ou de contenu de preuve dans les logs.
- Commits conventionnels ; PRs petites ; **patch plutôt que réécriture** ;
  pas de refactor opportuniste dans une PR de feature.
- Definition of Done d'une PR : lint + typecheck + tests verts, checklist
  OWASP du module cochée, migration réversible, seed démo mis à jour si
  le modèle change, capture d'écran si UI.
- Données de démo : tenant « Meridiane Logistics » (148 salariés,
  3 sites, périmètre SMSI+QMS) — cohérent partout, jamais de lorem ipsum.
- Le design system (`packages/ui`) est la seule source de tokens ;
  aucune couleur en dur dans les composants.

---

*Fin du plan v1.0 — les évolutions passent par PR sur ce document, avec
la même discipline que le code.*
