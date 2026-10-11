# Déploiement du staging (application)

Application (`apps/web`) et worker de livrables déployés automatiquement à
chaque fusion sur `main` (ADR-9), à l'adresse **https://app.toron.nullsec.fr**
(accès protégé). La vitrine reste sur Cloudflare Pages
(`docs/deploiement-vitrine.md`).

## Hébergement

Aucune offre gratuite ne convient sans enfreindre une règle du projet :
l'application a besoin d'un serveur Node permanent, du worker Typst et de
PostgreSQL 18 avec ses propres rôles (RLS), et les offres gratuites
sérieuses sont américaines (Vercel, Render, Neon, Supabase, Oracle).

Une petite VM européenne suffit : 2 vCPU, **4 Go de RAM**, 40 Go de disque,
Debian 12 ou Ubuntu 24.04. L'antivirus des fichiers déposés (clamd) occupe à
lui seul environ 1 Go une fois ses signatures chargées : avec 2 Go, la base
et l'application manqueraient de mémoire.

- **Hetzner Cloud** (Allemagne, Finlande) : le moins cher pour ce gabarit.
- **Scaleway** (France) : cohérent avec la production prévue (ADR-2).

Compter quelques euros par mois. Ajouter votre clé SSH personnelle à la
création de la VM.

## Fonctionnement

```
Internet ──443──> Caddy (TLS, authentification) ──> web ──> Postgres
                                                    web ──> clamd ──> signatures ClamAV
                                                    worker ──> Postgres
                                                    mail ──> Postgres
                                       (réseau interne, sans Internet)
clamd ──> signatures ClamAV (mises à jour, réseau antivirus)
mail ──> API Scaleway TEM (HTTPS, réseau courriel)
```

Outre web (réseau edge, derrière Caddy), seuls clamd et mail sortent sur
Internet, chacun par son propre réseau ; worker et Postgres n'ont aucune
sortie.

1. Fusion sur `main` : `.github/workflows/deploy-staging.yml` construit les
   images web et worker, les publie sur GHCR et signe une attestation de
   provenance.
2. Le job de déploiement copie `infra/staging/` sur le serveur par SSH
   (empreinte d'hôte épinglée) et lance `deployer.sh` avec les références
   **par digest** et un jeton GHCR éphémère.
3. `deployer.sh` tire les images, applique migrations et seed démo
   (idempotent), redémarre les services et attend leurs healthchecks.
4. Contrôle final : `https://app.toron.nullsec.fr/connexion` doit répondre
   401 (TLS valide, accès protégé).

## Mise en place (une fois)

1. **VM** créée chez l'hébergeur, avec votre clé SSH personnelle.
2. **DNS** de `nullsec.fr` : `app.toron  A  <IPv4 de la VM>` (et `AAAA`
   si IPv6).
3. **Clé de déploiement** de la CI, sur votre poste, dédiée à cet usage :
   ```sh
   ssh-keygen -t ed25519 -N '' -C toron-ci -f toron-ci
   ```
4. **Initialisation du serveur** (Docker, pare-feu, SSH par clé
   uniquement, mises à jour automatiques, secrets générés sur place) :
   ```sh
   ssh root@<IP> 'bash -s' -- app.toron.nullsec.fr "$(cat toron-ci.pub)" < infra/staging/bootstrap.sh
   ```
   Le script affiche **une seule fois** le mot de passe d'accès au staging
   (utilisateur `demo`) : le ranger dans un gestionnaire de mots de passe.
5. **Empreinte du serveur** : `ssh-keyscan -t ed25519 <IP>`, à comparer
   avec `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` exécuté sur la
   VM (console de l'hébergeur ou première connexion).
6. **GitHub**
   - *Settings > Secrets and variables > Actions > Variables* (dépôt) :
     `STAGING_HOST` = IP de la VM, `STAGING_URL` =
     `https://app.toron.nullsec.fr`.
   - *Settings > Environments > New environment* `staging`, *Deployment
     branches* : `main` uniquement. Secret `STAGING_SSH_KEY` = contenu du
     fichier `toron-ci` (clé privée), variable `STAGING_SSH_KNOWN_HOSTS` =
     ligne renvoyée par `ssh-keyscan`. Supprimer ensuite `toron-ci` du poste.
7. **Premier déploiement** : *Actions > Déploiement staging > Run workflow*
   sur `main`. Ensuite, chaque fusion est en ligne en quelques minutes.

Connexion à l'application : identifiants HTTP `demo`, puis un compte de démo
Meridiane Logistics du seed.

## Exploitation

- Journaux : `cd /opt/toron && docker compose --env-file .env --env-file images.env logs -f web`
- Retour arrière : relancer le workflow d'un commit antérieur (*Re-run all
  jobs*). Les migrations ne sont pas annulées : une migration destructive
  impose une migration corrective.
- Données de démo remises à zéro : `docker compose --env-file .env --env-file images.env down`,
  `docker volume rm toron_pgdata`, puis relancer le déploiement.
- Rotation du jeton de déploiement : nouvelle clé `toron-ci`, mise à jour
  de `/home/deploy/.ssh/authorized_keys` et du secret `STAGING_SSH_KEY`.

## Sécurité

- Staging entièrement derrière une authentification HTTP : le mot de passe
  des comptes de démo du seed est public (dépôt open source).
- Seul Caddy publie des ports. web, worker et Postgres ne sont pas
  joignables depuis Internet ; Postgres et le worker n'ont pas d'accès
  sortant. Caddy remplace tout `X-Forwarded-For` fourni par le client.
- Conteneurs en lecture seule, toutes capacités retirées (sauf liaison des
  ports 80/443 pour Caddy), `no-new-privileges`.
- Images tirées par digest, provenance vérifiable :
  `gh attestation verify oci://ghcr.io/xoudev/toron-web@<digest> -R xoudev/Toron`.
- Journaux d'accès de Caddy sans jeton : le jeton des liens d'invitation
  et du portail fournisseur, porté par le chemin (et parfois encodé dans
  `?suite=`), est remplacé par `[masque]` avant l'écriture, et l'en-tête
  `Referer` n'est pas journalisé. Vérification : la sortie de
  `docker compose … logs caddy` ne contient que des
  `/invitations/[masque]` et `/fournisseur/[masque]`.
- Secrets applicatifs générés sur le serveur (`/opt/toron/.env`, mode
  600), absents du dépôt et de GitHub. Rôles Postgres applicatifs sans
  superutilisateur ni BYPASSRLS.
- Limites connues : l'utilisateur `deploy` est membre du groupe docker
  (équivalent root sur une VM dédiée au staging) ; pas de sauvegarde, les
  données sont fictives. La production exigera sauvegardes et test de
  restauration (ADR-9).

## Service mail

Le service `mail` (même image que le worker) envoie les e-mails de la file
`email_outbox` sous le rôle `toron_mail_login`. Il démarre en transport
`fichier` : aucun envoi réel, les e-mails restent dans le volume
`courriels`. Le passage à Scaleway TEM, les variables et les runbooks sont
dans `docs/exploitation-courriel.md`.

**Serveur installé avant le service mail** : le script `01-roles.sh` ne
s'exécute qu'au premier démarrage du volume de données. Avant la fusion qui
introduit le service, et dans cet ordre :

1. Compléter `/opt/toron/.env` en relançant `bootstrap.sh` (étape 4 de la
   mise en place) **depuis un checkout de la branche qui introduit le
   service** : la version de `main` antérieure ne connaît pas ces clés. Il
   ajoute `TORON_MAIL_DB_PASSWORD`, `MAIL_OUTBOX_KEY` et
   `MAIL_TRANSPORT=fichier` sans toucher aux valeurs existantes.
2. Créer le rôle de connexion en tant que `deploy`. Le mot de passe passe
   par l'entrée standard de psql, jamais par la ligne de commande ; la
   commande s'arrête si `.env` ne le contient pas :
   ```sh
   cd /opt/toron
   (
     pw=$(sed -n 's/^TORON_MAIL_DB_PASSWORD=//p' .env)
     if [ -z "$pw" ]; then
       echo 'TORON_MAIL_DB_PASSWORD absent de .env : refaire l étape 1.' >&2
       exit 1
     fi
     {
       printf '\\set mail_pw %s\n' "$pw"
       cat <<'SQL'
   SELECT 'CREATE ROLE toron_mail NOLOGIN'
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'toron_mail') \gexec
   SELECT CASE WHEN EXISTS (SELECT FROM pg_roles WHERE rolname = 'toron_mail_login')
     THEN format('ALTER ROLE toron_mail_login PASSWORD %L', :'mail_pw')
     ELSE format('CREATE ROLE toron_mail_login LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L IN ROLE toron_mail', :'mail_pw')
   END \gexec
   SQL
     } | docker compose --env-file .env --env-file images.env exec -T db \
       psql -v ON_ERROR_STOP=1 -U toron_admin -d toron
   )
   ```
   Relancée, la commande réaligne le mot de passe du rôle sur `.env`. La
   migration 0041 donne ensuite à `toron_mail` ses seuls droits :
   l'exécution des fonctions de la file.
3. Fusionner : le déploiement applique la migration et démarre `mail`, dont
   le healthcheck doit passer.

E-mails déposés en transport fichier (liens à jeton, comptes fictifs) :
`docker compose --env-file .env --env-file images.env cp mail:/var/toron/courriels ./courriels`,
à supprimer après lecture.

## Antivirus

Chaque fichier déposé (preuve, version de document) est analysé par clamd
avant d'être enregistré. Sans réponse de clamd, le dépôt est refusé avec un
message explicite : jamais de fichier non analysé en base. `CLAMAV_URL` est
obligatoire en production (sans elle, l'application refuse de servir) et
`ANTIVIRUS_DESACTIVE` y est interdit. Au premier démarrage, clamd télécharge
ses signatures en quelques minutes : les dépôts attendent ce délai.
