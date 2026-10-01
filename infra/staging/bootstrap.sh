#!/usr/bin/env bash
# Prépare une VM neuve (Debian 12 ou Ubuntu 24.04) pour le staging Toron.
# À lancer une fois, en root, depuis votre poste (docs/deploiement-staging.md) :
#
#   ssh root@<IP> 'bash -s' -- <domaine> "$(cat toron-ci.pub)" < infra/staging/bootstrap.sh
#
# Idempotent : relançable sans écraser les secrets ni les accès existants.
set -euo pipefail
umask 077

readonly CADDY_IMAGE='caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b'
# Empreinte publiée de la clé de signature des paquets Docker.
readonly DOCKER_GPG_FPR='9DC858229FC7DD38854AE2D88D81803C0EBFCD88'
readonly RACINE=/opt/toron

domaine="${1:?usage : bootstrap.sh <domaine> <clé publique SSH ed25519 de la CI>}"
cle_ci="${2:?clé publique SSH de la CI manquante}"

[ "$(id -u)" -eq 0 ] || { echo "À exécuter en root." >&2; exit 1; }
[[ "$domaine" =~ ^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$ ]] || { echo "Domaine invalide : ${domaine}" >&2; exit 2; }
[[ "$cle_ci" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*(\ [[:print:]]*)?$ ]] || { echo "Clé publique attendue au format ssh-ed25519." >&2; exit 2; }

# shellcheck source=/dev/null
. /etc/os-release
case "$ID" in
  debian|ubuntu) ;;
  *) echo "Distribution non prise en charge : ${ID} (Debian 12 ou Ubuntu 24.04 attendu)." >&2; exit 1 ;;
esac
export DEBIAN_FRONTEND=noninteractive

echo "1/7 Mises à jour et paquets de base"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg openssl ufw unattended-upgrades

echo "2/7 Docker Engine (dépôt officiel, empreinte de clé vérifiée)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
fpr=$(gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc | awk -F: '/^fpr:/ {print $10; exit}')
if [ "$fpr" != "$DOCKER_GPG_FPR" ]; then
  rm -f /etc/apt/keyrings/docker.asc
  echo "Empreinte de la clé Docker inattendue (${fpr}) : installation interrompue." >&2
  exit 1
fi
chmod 644 /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
chmod 644 /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -yq docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "3/7 Démon Docker durci"
cat > /etc/docker/daemon.json <<'JSON'
{
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false,
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
chmod 644 /etc/docker/daemon.json
systemctl restart docker

echo "4/7 Utilisateur de déploiement (clé dédiée à la CI)"
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
# Le groupe docker équivaut à root sur cette machine : la VM n'héberge que
# le staging, sans aucune donnée réelle.
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf '%s\n' "$cle_ci" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

echo "5/7 SSH : authentification par clé uniquement"
cat > /etc/ssh/sshd_config.d/10-toron.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
SSHD
chmod 644 /etc/ssh/sshd_config.d/10-toron.conf
sshd -t
systemctl reload ssh 2>/dev/null || systemctl restart ssh

echo "6/7 Pare-feu (SSH, HTTP, HTTPS) et mises à jour de sécurité automatiques"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
chmod 644 /etc/apt/apt.conf.d/20auto-upgrades

echo "7/7 Répertoire applicatif, secrets et accès au staging"
install -d -m 750 -o deploy -g deploy "$RACINE"
if [ ! -f "${RACINE}/.env" ]; then
  {
    echo "STAGING_DOMAIN=${domaine}"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
    echo "TORON_APP_DB_PASSWORD=$(openssl rand -hex 32)"
    echo "TORON_AUTH_DB_PASSWORD=$(openssl rand -hex 32)"
    echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
  } > "${RACINE}/.env"
  chown deploy:deploy "${RACINE}/.env"
  chmod 600 "${RACINE}/.env"
  echo "Secrets générés dans ${RACINE}/.env (lisibles par root et deploy uniquement)."
fi
if [ ! -f "${RACINE}/acces.caddy" ]; then
  mdp=$(openssl rand -base64 24 | tr -d '/+=')
  empreinte=$(printf '%s\n' "$mdp" | docker run --rm -i "$CADDY_IMAGE" caddy hash-password)
  printf 'basic_auth {\n\tdemo %s\n}\n' "$empreinte" > "${RACINE}/acces.caddy"
  # Lu par Caddy, qui tourne sans capacité DAC_OVERRIDE : lecture pour tous
  # (hash bcrypt uniquement, jamais le mot de passe).
  chown deploy:deploy "${RACINE}/acces.caddy"
  chmod 644 "${RACINE}/acces.caddy"
  echo
  echo "Accès au staging https://${domaine} : utilisateur « demo », mot de passe : ${mdp}"
  echo "Affiché une seule fois : rangez-le dans votre gestionnaire de mots de passe."
  echo
fi

echo "Serveur prêt. Étape suivante : variables et secrets GitHub (docs/deploiement-staging.md)."
