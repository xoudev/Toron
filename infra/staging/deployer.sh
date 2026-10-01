#!/usr/bin/env bash
# Déploie une version de Toron sur le serveur de staging. Appelé par la CI
# (.github/workflows/deploy-staging.yml) via SSH, en tant qu'utilisateur deploy.
#
# Usage : printf '%s\n' "$JETON_GHCR" | deployer.sh <image-web@digest> <image-worker@digest>
#
# Le jeton GHCR (lecture seule, valable le temps du job CI) est lu sur
# l'entrée standard : il n'apparaît ni dans la ligne de commande ni dans
# l'historique, et il est retiré du serveur juste après le pull.
set -euo pipefail
umask 077

readonly RACINE=/opt/toron
readonly MOTIF_WEB='^ghcr\.io/xoudev/toron-web@sha256:[0-9a-f]{64}$'
readonly MOTIF_WORKER='^ghcr\.io/xoudev/toron-worker@sha256:[0-9a-f]{64}$'

image_web="${1:-}"
image_worker="${2:-}"
if ! [[ "$image_web" =~ $MOTIF_WEB && "$image_worker" =~ $MOTIF_WORKER ]]; then
  echo "Références d'images invalides : attendu ghcr.io/xoudev/toron-{web,worker}@sha256:<64 hex>." >&2
  exit 2
fi

cd "$RACINE"
if [ ! -f .env ] || [ ! -f acces.caddy ]; then
  echo "Serveur non initialisé (.env ou acces.caddy absent) : lancez d'abord bootstrap.sh." >&2
  exit 1
fi

compose() { docker compose --env-file .env --env-file images.env "$@"; }

# 1. Images figées par digest : exactement ce que la CI a construit et scanné.
printf 'TORON_WEB_IMAGE=%s\nTORON_WORKER_IMAGE=%s\n' "$image_web" "$image_worker" > images.env.nouveau

IFS= read -r jeton
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$jeton" | docker login ghcr.io --username deploy --password-stdin >/dev/null
unset jeton
docker pull --quiet "$image_web" >/dev/null
docker pull --quiet "$image_worker" >/dev/null
docker logout ghcr.io >/dev/null
mv images.env.nouveau images.env

# 2. Base, puis migrations et seed démo (idempotent) avec le rôle propriétaire.
compose up -d --wait db
compose run --rm migrations

# 3. Application : redémarrage des services modifiés, attente des healthchecks.
compose up -d --wait --remove-orphans
# Le Caddyfile est monté depuis le disque : rechargement à chaud, sans coupure.
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

# 4. Ménage : images qui ne sont plus utilisées par aucun conteneur.
docker image prune --force >/dev/null

echo "Staging à jour : ${image_web##*@} (web), ${image_worker##*@} (worker)."
