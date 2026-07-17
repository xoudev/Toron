-- ═══════════════════════════════════════════════════════════════════════
-- 0002 · Authentification Better Auth + contexte tenant (phase M0-3)
-- ═══════════════════════════════════════════════════════════════════════
-- ADR-4 : Better Auth auto-hébergée dans notre Postgres. Les credentials
-- (argon2id) vivent dans accounts, les secrets TOTP dans two_factors —
-- les colonnes password_hash / totp_secret de users (§4.1) sont donc
-- retirées au profit de ce stockage.
-- Nouveau rôle toron_auth : seul habilité sur les tables d'auth ; il
-- vérifie l'appartenance session → membership AVANT tout withTenant().
-- Le rôle applicatif toron_app n'a aucun droit sur ces tables (S5).

-- ── Rôle d'authentification ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'toron_auth') THEN
    CREATE ROLE toron_auth NOLOGIN;
  END IF;
END
$$;

-- ── users : colonnes Better Auth ────────────────────────────────────────
ALTER TABLE users
  DROP COLUMN password_hash,
  DROP COLUMN totp_secret,
  ADD COLUMN name text NOT NULL DEFAULT '',
  ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN image text,
  ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false;

-- ── tenants : slug d'URL (/t/[slug]/…, RM §5.1) ─────────────────────────
ALTER TABLE tenants ADD COLUMN slug text;
UPDATE tenants SET slug = id::text WHERE slug IS NULL;
ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX tenants_slug_unique ON tenants (slug);

-- ── Tables Better Auth ──────────────────────────────────────────────────
CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_token_unique ON sessions (token);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id               text NOT NULL,
  provider_id              text NOT NULL,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  password                 text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_idx ON accounts (user_id);

CREATE TABLE verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);

CREATE TABLE two_factors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret       text NOT NULL,
  backup_codes text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX two_factors_user_idx ON two_factors (user_id);

-- Triggers updated_at
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions', 'accounts', 'verifications']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END
$$;

-- ── RLS des tables d'auth : accès intégral pour toron_auth, rien pour
--    toron_app (aucune politique, aucun grant) ──────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions', 'accounts', 'verifications', 'two_factors']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY auth_full ON %I FOR ALL TO toron_auth USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END
$$;

-- toron_auth voit et gère les identités globales (login hors contexte
-- tenant), crée le tenant et le membership owner à l'inscription, et
-- vérifie l'appartenance avant tout withTenant().
CREATE POLICY users_auth_all ON users FOR ALL TO toron_auth
  USING (true) WITH CHECK (true);
CREATE POLICY tenants_auth_select ON tenants FOR SELECT TO toron_auth
  USING (true);
CREATE POLICY tenants_auth_insert ON tenants FOR INSERT TO toron_auth
  WITH CHECK (true);
CREATE POLICY memberships_auth_select ON memberships FOR SELECT TO toron_auth
  USING (true);
CREATE POLICY memberships_auth_insert ON memberships FOR INSERT TO toron_auth
  WITH CHECK (true);

-- ── Droits ──────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO toron_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, accounts, verifications, two_factors TO toron_auth;
GRANT SELECT, INSERT, UPDATE ON users TO toron_auth;
GRANT SELECT, INSERT ON tenants TO toron_auth;
GRANT SELECT, INSERT ON memberships TO toron_auth;
