-- ═══════════════════════════════════════════════════════════════════════
-- 0001 · Socle multi-tenant — sections 4.1 & 4.2 du PLAN (phase M0)
-- ═══════════════════════════════════════════════════════════════════════
-- Principes appliqués ici :
--   S1  isolation par RLS, politique par variable de session app.tenant_id
--       (ADR-3) ; FORCE ROW LEVEL SECURITY sur toutes les tables métier.
--   S5  moindre privilège : le rôle applicatif toron_app (NOLOGIN, sans
--       BYPASSRLS) reçoit uniquement les droits nécessaires ; les rôles de
--       connexion par environnement font `GRANT toron_app TO <login>`.
--   P4  aucun texte normatif ISO en base : title_internal/guidance_internal
--       sont des reformulations maison.
-- La politique RLS lit current_setting('app.tenant_id') SANS missing_ok :
-- toute requête hors transaction withTenant() échoue bruyamment (S4),
-- plutôt que de retourner silencieusement zéro ligne.

-- ── Rôle applicatif ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'toron_app') THEN
    CREATE ROLE toron_app NOLOGIN;
  END IF;
END
$$;

-- ── Types énumérés ──────────────────────────────────────────────────────
CREATE TYPE tenant_plan AS ENUM ('decouverte', 'standard', 'entreprise');
CREATE TYPE membership_role AS ENUM
  ('owner', 'direction', 'rssi', 'resp_qualite', 'pilote', 'auditeur', 'contributeur', 'lecteur');
CREATE TYPE scope_kind AS ENUM ('smsi', 'qms', 'mixte');
CREATE TYPE framework_source AS ENUM ('builtin', 'custom');
CREATE TYPE control_status AS ENUM ('brouillon', 'actif', 'archive');
CREATE TYPE review_frequency AS ENUM ('mensuelle', 'trimestrielle', 'semestrielle', 'annuelle');
CREATE TYPE assessment_status AS ENUM ('planifiee', 'en_cours', 'cloturee');
CREATE TYPE assessment_item_status AS ENUM ('conforme', 'ecart', 'non_applicable', 'a_evaluer');

-- ── Horodatage de mise à jour ───────────────────────────────────────────
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

-- ═══ 4.1 · Organisation & accès ═════════════════════════════════════════

CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  plan       tenant_plan NOT NULL DEFAULT 'decouverte',
  region     text NOT NULL DEFAULT 'eu-fr',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text,
  totp_secret   text,
  locale        text NOT NULL DEFAULT 'fr',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE legal_entities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,
  siren      text CHECK (siren IS NULL OR siren ~ '^[0-9]{9}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX legal_entities_tenant_idx ON legal_entities (tenant_id);

CREATE TABLE sites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  entity_id  uuid NOT NULL REFERENCES legal_entities(id),
  name       text NOT NULL,
  address    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_tenant_idx ON sites (tenant_id);

CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  role       membership_role NOT NULL DEFAULT 'lecteur',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_tenant_user_unique UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE scopes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,
  kind       scope_kind NOT NULL,
  entity_ids uuid[] NOT NULL DEFAULT '{}',
  site_ids   uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scopes_tenant_idx ON scopes (tenant_id);

-- Journal d'audit immuable (S6). Les droits sont restreints à
-- SELECT + INSERT dès maintenant ; le trigger anti-UPDATE/DELETE
-- (défense contre le propriétaire lui-même) arrive en M0-4.
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  at            timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  action        text NOT NULL,
  object_type   text NOT NULL,
  object_id     uuid,
  before        jsonb,
  after         jsonb,
  ip            inet,
  user_agent    text
);
CREATE INDEX audit_log_tenant_at_idx ON audit_log (tenant_id, at DESC);

-- ═══ 4.2 · Moteur de référentiels ═══════════════════════════════════════

-- tenant_id NULL ⇒ référentiel builtin, partagé en lecture par tous les
-- tenants ; non NULL ⇒ référentiel custom du tenant.
CREATE TABLE frameworks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id),
  code       text NOT NULL,
  version    text NOT NULL,
  name       text NOT NULL,
  source     framework_source NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT frameworks_builtin_global CHECK ((source = 'builtin') = (tenant_id IS NULL)),
  CONSTRAINT frameworks_code_version_unique UNIQUE NULLS NOT DISTINCT (tenant_id, code, version)
);

CREATE TABLE requirements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenants(id),
  framework_id       uuid NOT NULL REFERENCES frameworks(id),
  ref_id             text NOT NULL,
  parent_id          uuid REFERENCES requirements(id),
  title_internal     text NOT NULL,
  guidance_internal  text,
  applicable_default boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requirements_framework_ref_unique UNIQUE (framework_id, ref_id)
);
CREATE INDEX requirements_framework_idx ON requirements (framework_id);
CREATE INDEX requirements_parent_idx ON requirements (parent_id);

CREATE TABLE controls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  title            text NOT NULL,
  description      text,
  owner_user_id    uuid REFERENCES users(id),
  review_frequency review_frequency,
  status           control_status NOT NULL DEFAULT 'actif',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX controls_tenant_idx ON controls (tenant_id);

-- La table de mutualisation (P1) : un contrôle ↔ N exigences.
CREATE TABLE control_requirements (
  control_id     uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (control_id, requirement_id)
);
CREATE INDEX control_requirements_tenant_idx ON control_requirements (tenant_id);
CREATE INDEX control_requirements_requirement_idx ON control_requirements (requirement_id);

CREATE TABLE scope_frameworks (
  scope_id     uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  framework_id uuid NOT NULL REFERENCES frameworks(id),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  activated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, framework_id)
);
CREATE INDEX scope_frameworks_tenant_idx ON scope_frameworks (tenant_id);

CREATE TABLE assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  framework_id   uuid NOT NULL REFERENCES frameworks(id),
  scope_id       uuid NOT NULL REFERENCES scopes(id),
  campaign_label text NOT NULL,
  status         assessment_status NOT NULL DEFAULT 'planifiee',
  started_at     timestamptz,
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assessments_tenant_idx ON assessments (tenant_id);

CREATE TABLE assessment_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  assessment_id     uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  requirement_id    uuid NOT NULL REFERENCES requirements(id),
  status            assessment_item_status NOT NULL DEFAULT 'a_evaluer',
  statement         text,
  soa_included      boolean NOT NULL DEFAULT true,
  soa_justification text,
  assessed_by       uuid REFERENCES users(id),
  assessed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_items_assessment_req_unique UNIQUE (assessment_id, requirement_id),
  -- RM §5.3 : non_applicable sans justification = enregistrement refusé (S2)
  CONSTRAINT assessment_items_na_justifiee CHECK (
    status <> 'non_applicable'
    OR (soa_justification IS NOT NULL AND btrim(soa_justification) <> '')
  )
);
CREATE INDEX assessment_items_tenant_idx ON assessment_items (tenant_id);

-- ── Triggers updated_at ─────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'users', 'legal_entities', 'sites', 'memberships', 'scopes',
    'frameworks', 'requirements', 'controls', 'assessments', 'assessment_items'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END
$$;

-- ═══ RLS — isolation par tenant (S1, ADR-3) ═════════════════════════════

-- Tables strictement tenant-scopées : une politique unique lecture/écriture.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legal_entities', 'sites', 'memberships', 'scopes', 'audit_log',
    'controls', 'control_requirements', 'scope_frameworks',
    'assessments', 'assessment_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
      t
    );
  END LOOP;
END
$$;

-- tenants : le tenant courant uniquement ; ni création ni suppression par
-- le rôle applicatif (la création de tenant est une opération système).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_select ON tenants FOR SELECT TO toron_app
  USING (id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_self_update ON tenants FOR UPDATE TO toron_app
  USING (id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (id = current_setting('app.tenant_id')::uuid);

-- users : visibles uniquement s'ils sont membres du tenant courant.
-- Aucune politique d'écriture pour toron_app en M0-2 (l'écriture arrive
-- avec la couche d'authentification, M0-3, sous son propre contrôle).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_same_tenant_select ON users FOR SELECT TO toron_app
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = users.id
      AND m.tenant_id = current_setting('app.tenant_id')::uuid
  ));

-- frameworks / requirements : lecture des builtins (tenant_id NULL) et du
-- tenant courant ; écriture réservée aux objets du tenant courant —
-- les builtins sont donc immuables pour le rôle applicatif.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['frameworks', 'requirements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY builtin_or_tenant_select ON %I FOR SELECT TO toron_app
         USING (tenant_id IS NULL OR tenant_id = current_setting(''app.tenant_id'')::uuid)',
      t
    );
    EXECUTE format(
      'CREATE POLICY tenant_insert ON %I FOR INSERT TO toron_app
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
      t
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON %I FOR UPDATE TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
      t
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON %I FOR DELETE TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)',
      t
    );
  END LOOP;
END
$$;

-- ── Vue de mutualisation ────────────────────────────────────────────────
-- Le PLAN (§4.2) évoque une vue matérialisée ; une MV ne porte pas de RLS,
-- ce qui ferait fuiter des agrégats inter-tenants. On retient une vue
-- security_invoker : les politiques RLS du lecteur s'appliquent (S1 > perf,
-- volumétrie PME/ETI très faible). À réévaluer si besoin en V2.
CREATE VIEW mutualized_controls
WITH (security_invoker = on) AS
SELECT
  c.tenant_id,
  c.id AS control_id,
  count(DISTINCT r.framework_id) AS framework_count
FROM controls c
JOIN control_requirements cr ON cr.control_id = c.id
JOIN requirements r ON r.id = cr.requirement_id
GROUP BY c.tenant_id, c.id
HAVING count(DISTINCT r.framework_id) >= 2;

-- ── Droits du rôle applicatif (S5 : moindre privilège) ──────────────────
GRANT USAGE ON SCHEMA public TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  legal_entities, sites, memberships, scopes,
  frameworks, requirements, controls, control_requirements,
  scope_frameworks, assessments, assessment_items
TO toron_app;
GRANT SELECT, UPDATE ON tenants TO toron_app;
GRANT SELECT ON users TO toron_app;
GRANT SELECT, INSERT ON audit_log TO toron_app;
GRANT SELECT ON mutualized_controls TO toron_app;
