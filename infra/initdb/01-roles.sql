-- Rôles de connexion LOCAUX (poste dev / compose uniquement — jamais en
-- staging/production, où les rôles sont créés par l'hébergeur avec des
-- secrets gérés hors repo, S3/S5).
-- Les rôles NOLOGIN toron_app / toron_auth sont (re)créés idempotents ici
-- car ce script s'exécute avant les migrations au premier démarrage.

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

-- Identifiants de développement local uniquement (base non exposée).
CREATE ROLE toron_app_login LOGIN PASSWORD 'toron_app_dev_only';
GRANT toron_app TO toron_app_login;

CREATE ROLE toron_auth_login LOGIN PASSWORD 'toron_auth_dev_only';
GRANT toron_auth TO toron_auth_login;
