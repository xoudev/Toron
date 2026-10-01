#!/bin/sh
# Rôles de connexion du staging, créés au PREMIER démarrage du volume de
# données (docker-entrypoint-initdb.d). Mots de passe lus dans
# l'environnement (/opt/toron/.env sur le serveur), jamais dans le dépôt.
# Les variables psql (:'...') sont citées par psql : aucune injection SQL
# possible via le contenu des mots de passe.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_pw="$TORON_APP_DB_PASSWORD" \
  -v auth_pw="$TORON_AUTH_DB_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'toron_app') THEN
    CREATE ROLE toron_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'toron_auth') THEN
    CREATE ROLE toron_auth NOLOGIN;
  END IF;
END
$$;

-- Ni superutilisateur ni BYPASSRLS : les politiques RLS s'appliquent (ADR-3).
CREATE ROLE toron_app_login LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_pw' IN ROLE toron_app;
CREATE ROLE toron_auth_login LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'auth_pw' IN ROLE toron_auth;
SQL
