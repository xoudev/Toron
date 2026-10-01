#!/usr/bin/env bash
# Installe un outil de sécurité de la CI depuis sa release officielle, avec
# version ET empreinte SHA-256 figées : une archive republiée ou altérée fait
# échouer le job au lieu de s'exécuter. Aucune action tierce n'est impliquée.
#
# Usage : bash .github/scripts/installer-outil.sh <gitleaks|grype|syft|actionlint>
#
# Mise à jour : Dependabot ne suit pas ce fichier. Changer la version ET
# l'empreinte ensemble, en reprenant la valeur du fichier de sommes de
# contrôle publié avec la release (jamais une empreinte recalculée seule).
set -euo pipefail

outil="${1:?usage : installer-outil.sh <gitleaks|grype|syft|actionlint>}"

case "$outil" in
  gitleaks)
    url="https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz"
    sha256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    ;;
  grype)
    url="https://github.com/anchore/grype/releases/download/v0.119.0/grype_0.119.0_linux_amd64.tar.gz"
    sha256="3fa2dc4b924621ab65404cf08d0b8438d896d80ab949c9d5a4ca283c36004c9b"
    ;;
  syft)
    url="https://github.com/anchore/syft/releases/download/v1.52.0/syft_1.52.0_linux_amd64.tar.gz"
    sha256="caeedb81fb0491615f1ebd1761e4145d41ee86dd2cc7bf80669f9f5ad9d6133d"
    ;;
  actionlint)
    url="https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz"
    sha256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
    ;;
  *)
    echo "Outil inconnu : ${outil}. Valeurs possibles : gitleaks, grype, syft, actionlint." >&2
    exit 2
    ;;
esac

dest="${RUNNER_TEMP:-/tmp}/outils"
mkdir -p "$dest"
archive="${dest}/${outil}.tar.gz"

curl -sSfL --retry 3 -o "$archive" "$url"
if ! echo "${sha256}  ${archive}" | sha256sum -c --quiet -; then
  echo "Empreinte SHA-256 invalide pour ${outil} : archive altérée ou republiée, installation refusée." >&2
  exit 1
fi
tar -xzf "$archive" -C "$dest" "$outil"
rm -f "$archive"

# Rend l'outil disponible pour les étapes suivantes du job.
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$dest" >> "$GITHUB_PATH"
fi
echo "${outil} installé et vérifié (${url##*/})."
