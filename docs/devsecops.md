# DevSecOps : chaîne CI et réglages du dépôt

## Gates de la CI (`.github/workflows/ci.yml`)

| Job | Bloque la fusion si |
| --- | --- |
| Lint · Typecheck · Tests · Build | lint, types, tests (dont isolation cross-tenant) ou build en échec ; licence AGPL, GPL, SSPL ou BUSL en production |
| SAST (semgrep) | règle par défaut ou TypeScript déclenchée (résultats dans l'onglet Security) |
| Secrets (gitleaks) | secret présent dans **tout** l'historique git, pas seulement le diff |
| Audit dépendances | vulnérabilité ≥ moderate en production, ≥ high ailleurs (lecture du lockfile, aucun script d'installation exécuté) |
| Revue des dépendances (PR) | la PR ajoute une dépendance vulnérable (≥ moderate) ou sous licence interdite |
| Sécurité des workflows | zizmor (injections, permissions, épinglage, identifiants persistés, commits imposteurs) ou actionlint et shellcheck |
| Dockerfiles (hadolint) | avertissement hadolint (exceptions justifiées dans `.hadolint.yaml`) |
| Docker | build web et worker, smoke test HTTP, vulnérabilité high corrigeable dans les images (grype) ; SBOM CycloneDX conservé 90 jours |
| **CI OK** | un des gates ci-dessus n'est pas vert : **seule vérification à rendre obligatoire** |

Autres workflows : **CodeQL** (JavaScript/TypeScript et GitHub Actions,
requêtes `security-extended`), **Scorecard** (OpenSSF), **Déploiement
vitrine**.

Planification : la CI tourne chaque nuit sur `main` (une CVE publiée après
la fusion la fait passer au rouge sans nouveau commit), CodeQL et Scorecard
chaque semaine.

## Chaîne d'approvisionnement

- Actions GitHub épinglées par SHA de commit, versions Node 24, mises à
  jour par Dependabot avec un délai de 7 jours (`.github/dependabot.yml`).
- Images d'outils (semgrep, zizmor, hadolint) épinglées par digest.
- Binaires gitleaks, grype, syft et actionlint vérifiés par SHA-256
  (`.github/scripts/installer-outil.sh`). Dependabot ne suit pas ce
  fichier : changer version et empreinte ensemble, depuis le fichier de
  sommes de contrôle de la release.
- pnpm : `minimumReleaseAge` 7 jours, `allowBuilds`, `blockExoticSubdeps`,
  `trustPolicy: no-downgrade`, overrides de sécurité commentés.
- Images de base Node et Postgres épinglées par tag et digest ; archive
  Typst vérifiée par SHA-256 dans `infra/worker.Dockerfile`.
- Workflows : `permissions: {}` par défaut, droits accordés job par job,
  `persist-credentials: false` partout, délais d'exécution bornés.

## Réglages GitHub à activer (administrateur du dépôt, une fois)

1. **Settings > Rules > Rulesets > New branch ruleset**, cible : branche
   par défaut.
   - *Restrict deletions* et *Block force pushes*.
   - *Require a pull request before merging*.
   - *Require status checks to pass* : `CI OK`, avec *Require branches to
     be up to date*.
   - *Require code scanning results* : CodeQL, seuil d'alerte de sécurité
     *High or higher*.

   Sans ce ruleset, une PR peut être fusionnée avant la fin de la CI
   (cas de la PR #51, fusionnée 8 secondes après sa création).
2. **Settings > Code security** (page `settings/security_analysis`) :
   **Dependency graph** (prérequis du gate
   « Revue des dépendances », qui échoue sinon avec « Dependency review is
   not supported on this repository »), Dependabot alerts, Dependabot
   security updates, Secret scanning, Push protection, Private
   vulnerability reporting (utilisé par `SECURITY.md`).
3. **Settings > General** : *Automatically delete head branches*.

## Exceptions (acceptation de risque)

Une vulnérabilité sans correctif disponible ne doit pas bloquer
indéfiniment : l'ignorer explicitement, jamais en désactivant un gate.

- pnpm : `auditConfig.ignoreGhsas` dans `pnpm-workspace.yaml`.
- grype : fichier `.grype.yaml` (`ignore` par identifiant de vulnérabilité).

Chaque exception porte en commentaire la justification, l'exposition
réelle et une date de revue ; elle est retirée dès qu'un correctif existe.
