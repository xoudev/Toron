#!/usr/bin/env bash
# Parcours « mot de passe oublié » de bout en bout, sans navigateur (job
# docker de la CI, PLAN §8.1). Prérequis : base migrée et seedée à neuf, web
# et service mail démarrés par infra/compose.yaml, transport fichier.
#
# Ni l'adresse, ni les mots de passe, ni le jeton ne sont affichés : les
# corps JSON passent par l'entrée standard de curl, les réponses par des
# fichiers temporaires dont seul le champ « code » est lu en cas d'échec.
#
# Usage : bash .github/scripts/parcours-mot-de-passe.sh
set -euo pipefail
export LC_ALL=C

cd "$(dirname "$0")/../.."

BASE=http://localhost:3000
ORIGINE=http://localhost:3000
# Compte de démo sans TOTP (packages/db/src/seed.ts).
ADRESSE='camille.poirier@meridiane-logistics.example'
ANCIEN='Meridiane#Demo2026'
INCONNUE='personne.inconnue@meridiane-logistics.example'
SUJET_REINIT='Réinitialisation de votre mot de passe Toron'
SUJET_MODIFIE='Votre mot de passe Toron a été modifié'
LIEN_ATTENDU='^http://localhost:3000/mot-de-passe/nouveau#jeton=[A-Za-z0-9]{24}$'

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

compose() { docker compose -f infra/compose.yaml "$@"; }

echec() {
  echo "::error::$*" >&2
  exit 1
}

# Masque une valeur dans la sortie du job, au cas où un outil la citerait.
masquer() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$1"; fi
}

# Code d'erreur Better Auth de la réponse, jamais le corps entier (il peut
# contenir l'adresse).
code_reponse() {
  jq -r '.code? // "aucun"' "$1" 2>/dev/null || echo 'illisible'
}

attendu() {
  local etape="$1" obtenu="$2" voulu="$3" reponse="$4"
  [ "$obtenu" = "$voulu" ] || echec "${etape} : HTTP ${obtenu} au lieu de ${voulu} (code : $(code_reponse "$reponse"))."
}

# POST JSON, corps lu sur l'entrée standard ; affiche le code HTTP. Chaque
# appel porte sa propre adresse IP de test (X-Forwarded-For) pour rester
# sous les limites du proxy et de Better Auth.
post_json() {
  local chemin="$1" ip="$2" sortie="$3"
  shift 3
  curl -sS -o "$sortie" -w '%{http_code}' \
    -H 'Content-Type: application/json' -H "Origin: ${ORIGINE}" -H "X-Forwarded-For: ${ip}" \
    "$@" --data-binary @- "${BASE}${chemin}"
}

get() {
  local chemin="$1" ip="$2" sortie="$3"
  shift 3
  curl -sS -o "$sortie" -w '%{http_code}' \
    -H "Origin: ${ORIGINE}" -H "X-Forwarded-For: ${ip}" "$@" "${BASE}${chemin}"
}

connexion() {
  local ip="$1" mot_de_passe="$2" sortie="$3"
  shift 3
  jq -nc --arg email "$ADRESSE" --arg password "$mot_de_passe" '{email: $email, password: $password}' \
    | post_json /api/auth/sign-in/email "$ip" "$sortie" "$@"
}

reinitialiser() {
  local ip="$1" mot_de_passe="$2" sortie="$3"
  jq -nc --arg newPassword "$mot_de_passe" --arg token "$jeton" '{newPassword: $newPassword, token: $token}' \
    | post_json /api/auth/reset-password "$ip" "$sortie"
}

# Les fichiers déposés (mode 0600) appartiennent à l'utilisateur du
# conteneur ; docker compose cp les recrée au nom du runner. Remplit
# $tmp/nouveaux.txt avec les .json apparus depuis le début du parcours.
copie=0
releve_courriels() {
  copie=$((copie + 1))
  REPERTOIRE="${tmp}/courriels-${copie}"
  compose cp mail:/var/toron/courriels "$REPERTOIRE" >/dev/null
  find "$REPERTOIRE" -maxdepth 1 -name '*.json' -printf '%f\n' | sort > "${tmp}/presents.txt"
  comm -13 "${tmp}/avant.txt" "${tmp}/presents.txt" > "${tmp}/nouveaux.txt"
}

nombre_nouveaux() {
  wc -l < "${tmp}/nouveaux.txt" | tr -d ' '
}

# Attend qu'exactement $1 nouveaux e-mails soient déposés (60 s au plus).
attendre_courriels() {
  local voulu="$1" n
  for _ in $(seq 1 60); do
    releve_courriels
    n="$(nombre_nouveaux)"
    if [ "$n" -gt "$voulu" ]; then echec "${n} e-mails déposés au lieu de ${voulu}."; fi
    if [ "$n" -eq "$voulu" ]; then return 0; fi
    sleep 1
  done
  compose logs --no-color mail | tail -n 50
  compose logs --no-color web | grep -F '[courriel]' | tail -n 20 || true
  compose exec -T mail node workers/src/mail-etat.ts || true
  echec "Aucun e-mail déposé dans les 60 s (${voulu} attendus) : vérifiez que .courriels existe et est inscriptible (mkdir -m 777 .courriels), que le service mail tourne, puis lisez les journaux et l’état de la file ci-dessus."
}

# Vérifie destinataire et objet d'un e-mail déposé, sans les afficher.
verifier_courriel() {
  local fichier="$1" sujet="$2"
  jq -e --arg to "$ADRESSE" '.to == $to' "$fichier" >/dev/null \
    || echec "E-mail adressé ailleurs qu'à l'adresse stockée, en minuscules."
  jq -e --arg s "$sujet" '.subject == $s' "$fichier" >/dev/null \
    || echec "Objet inattendu : « ${sujet} » attendu."
}

# ── 0. Préconditions ───────────────────────────────────────────────────
# Une clé différente rendrait les secrets de la file illisibles par le
# service mail : aucun e-mail, sans autre symptôme.
compose config --format json | jq -e '
  .services.web.environment as $w | .services.mail.environment as $m
  | ($w.MAIL_OUTBOX_KEY // "") != "" and $w.MAIL_OUTBOX_KEY == $m.MAIL_OUTBOX_KEY
    and ($w.TORON_ENV // "") != "" and $w.TORON_ENV == $m.TORON_ENV' >/dev/null \
  || echec "Le web et le service mail doivent partager TORON_ENV et MAIL_OUTBOX_KEY (infra/compose.yaml)."

NOUVEAU="Reinit-$(openssl rand -hex 16)"
masquer "$ANCIEN"
masquer "$NOUVEAU"
: > "${tmp}/avant.txt"
releve_courriels
cp "${tmp}/presents.txt" "${tmp}/avant.txt"

# ── 1. Session A ouverte avec l'ancien mot de passe ────────────────────
code="$(connexion 198.51.100.1 "$ANCIEN" "${tmp}/connexion-a.json" -c "${tmp}/session-a.txt")"
attendu "Connexion avec l’ancien mot de passe" "$code" 200 "${tmp}/connexion-a.json"
grep -q 'better-auth\.session_token' "${tmp}/session-a.txt" || echec 'Connexion sans cookie de session.'
code="$(get /api/auth/get-session 198.51.100.2 "${tmp}/session-a-avant.json" -b "${tmp}/session-a.txt")"
attendu 'Session A avant réinitialisation' "$code" 200 "${tmp}/session-a-avant.json"
jq -e '.session.id | type == "string"' "${tmp}/session-a-avant.json" >/dev/null || echec 'Session A introuvable avant réinitialisation.'
echo '1. Session A ouverte.'

# ── 2. Demandes : compte connu en majuscules, puis adresse inconnue ────
code="$(jq -nc --arg email "$(printf '%s' "$ADRESSE" | tr '[:lower:]' '[:upper:]')" '{email: $email}' \
  | post_json /api/auth/request-password-reset 198.51.100.3 "${tmp}/demande-connue.json")"
attendu 'Demande pour le compte connu' "$code" 200 "${tmp}/demande-connue.json"
code="$(jq -nc --arg email "$INCONNUE" '{email: $email}' \
  | post_json /api/auth/request-password-reset 198.51.100.4 "${tmp}/demande-inconnue.json")"
attendu 'Demande pour une adresse inconnue' "$code" 200 "${tmp}/demande-inconnue.json"
cmp -s "${tmp}/demande-connue.json" "${tmp}/demande-inconnue.json" \
  || echec 'Réponses différentes pour un compte connu et une adresse inconnue (énumération).'
echo '2. Réponses identiques, compte connu ou inconnu.'

# ── 3. Un seul e-mail, à l'adresse stockée, lien à fragment ────────────
attendre_courriels 1
# Laisse passer quelques cycles du service : la demande inconnue ne doit
# rien déposer.
sleep 6
releve_courriels
[ "$(nombre_nouveaux)" -eq 1 ] || echec "$(nombre_nouveaux) e-mails déposés après deux demandes, 1 attendu."
reinit="${REPERTOIRE}/$(head -n 1 "${tmp}/nouveaux.txt")"
verifier_courriel "$reinit" "$SUJET_REINIT"
jq -r '.text' "$reinit" | grep -oE 'https?://[^[:space:]]+' > "${tmp}/liens.txt" || true
[ "$(wc -l < "${tmp}/liens.txt")" -eq 1 ] || echec "Le texte de l’e-mail doit porter exactement un lien."
lien="$(head -n 1 "${tmp}/liens.txt")"
[[ "$lien" =~ $LIEN_ATTENDU ]] || echec 'Lien hors de la forme http://localhost:3000/mot-de-passe/nouveau#jeton=<24 caractères>.'
jeton="${lien##*#jeton=}"
masquer "$jeton"
if jq -r '.text, .html' "$reinit" | grep -qE 'token=|/api/auth/reset-password'; then
  echec 'Le jeton figure ailleurs que dans le fragment du lien.'
fi
echo '3. Un e-mail, adresse stockée, jeton dans le fragment seulement.'

# ── 4. GET à jeton fermé ───────────────────────────────────────────────
code="$(get "/api/auth/reset-password/${jeton}" 198.51.100.5 "${tmp}/get-jeton.txt")"
attendu 'GET /api/auth/reset-password/<jeton>' "$code" 404 "${tmp}/get-jeton.txt"
echo '4. GET à jeton : 404.'

# ── 5. Trop court, puis valide, puis rejeu ─────────────────────────────
code="$(reinitialiser 198.51.100.6 "${NOUVEAU:0:11}" "${tmp}/reinit-court.json")"
attendu 'Mot de passe de 11 caractères' "$code" 400 "${tmp}/reinit-court.json"
[ "$(code_reponse "${tmp}/reinit-court.json")" = 'PASSWORD_TOO_SHORT' ] || echec 'PASSWORD_TOO_SHORT attendu.'
code="$(reinitialiser 198.51.100.7 "$NOUVEAU" "${tmp}/reinit.json")"
attendu 'Réinitialisation (le lien doit rester valable après un refus)' "$code" 200 "${tmp}/reinit.json"
code="$(reinitialiser 198.51.100.8 "$NOUVEAU" "${tmp}/reinit-rejeu.json")"
attendu 'Rejeu du lien' "$code" 400 "${tmp}/reinit-rejeu.json"
[ "$(code_reponse "${tmp}/reinit-rejeu.json")" = 'INVALID_TOKEN' ] || echec 'INVALID_TOKEN attendu au rejeu.'
echo '5. Trop court : 400 ; valide : 200 ; rejeu : 400 INVALID_TOKEN.'

# ── 6. Session A révoquée ──────────────────────────────────────────────
code="$(get /api/auth/get-session 198.51.100.9 "${tmp}/session-a-apres.json" -b "${tmp}/session-a.txt")"
attendu 'Session A après réinitialisation' "$code" 200 "${tmp}/session-a-apres.json"
jq -e '. == null' "${tmp}/session-a-apres.json" >/dev/null || echec 'La session A a survécu à la réinitialisation.'
echo '6. Session A révoquée.'

# ── 7. Ancien mot de passe refusé, nouveau accepté ─────────────────────
code="$(connexion 198.51.100.10 "$ANCIEN" "${tmp}/connexion-ancien.json")"
attendu "Connexion avec l’ancien mot de passe" "$code" 401 "${tmp}/connexion-ancien.json"
[ "$(code_reponse "${tmp}/connexion-ancien.json")" = 'INVALID_EMAIL_OR_PASSWORD' ] || echec 'INVALID_EMAIL_OR_PASSWORD attendu.'
code="$(connexion 198.51.100.11 "$NOUVEAU" "${tmp}/connexion-nouveau.json" -c "${tmp}/session-b.txt")"
attendu 'Connexion avec le nouveau mot de passe' "$code" 200 "${tmp}/connexion-nouveau.json"
grep -q 'better-auth\.session_token' "${tmp}/session-b.txt" || echec 'Connexion sans cookie de session.'
echo '7. Ancien mot de passe refusé, nouveau accepté.'

# ── 8. E-mail « mot de passe modifié » ─────────────────────────────────
attendre_courriels 2
modifie=''
while read -r nom; do
  if jq -e --arg s "$SUJET_MODIFIE" '.subject == $s' "${REPERTOIRE}/${nom}" >/dev/null; then
    modifie="${REPERTOIRE}/${nom}"
  fi
done < "${tmp}/nouveaux.txt"
[ -n "$modifie" ] || echec "Aucun e-mail « ${SUJET_MODIFIE} »."
verifier_courriel "$modifie" "$SUJET_MODIFIE"
if jq -r '.text, .html' "$modifie" | grep -qF "$jeton"; then
  echec "L’e-mail « modifié » cite le jeton consommé."
fi
echo '8. E-mail « mot de passe modifié » déposé.'

# ── 9. Journaux web et mail sans adresse ni secret ─────────────────────
compose logs --no-color web mail > "${tmp}/journaux.txt"
fuites="$(grep -ciE 'camille|\.example|jeton=' "${tmp}/journaux.txt" || true)"
secrets="$(grep -cF -e "$jeton" -e "$NOUVEAU" -e "$ANCIEN" "${tmp}/journaux.txt" || true)"
if [ "$fuites" -ne 0 ] || [ "$secrets" -ne 0 ]; then
  echec "Journaux web ou mail : ${fuites} ligne(s) citant une adresse ou un lien, ${secrets} citant un jeton ou un mot de passe."
fi
echo '9. Journaux web et mail sans adresse, jeton ni mot de passe.'
echo 'Parcours mot de passe oublié : conforme.'
