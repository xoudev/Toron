-- ═══════════════════════════════════════════════════════════════════════
-- 0008 · Gestion documentaire (module 5.6, phase MVP « light »)
-- ═══════════════════════════════════════════════════════════════════════
-- Documents versionnés à statut simple (brouillon → publié). RM §5.6 : une
-- version PUBLIÉE est immuable — pour changer, on crée une nouvelle version.
-- Les exigences couvertes par un document alimentent la Déclaration
-- d'applicabilité. Stockage local (bytea) en MVP ; en prod, file_ref pointera
-- l'Object Storage Scaleway (URL signée). Workflow complet (relecture,
-- approbations, accusés de lecture) = phase V1.

CREATE TYPE document_type AS ENUM (
  'pssi', 'politique', 'procedure', 'charte', 'pca_pra', 'fiche_processus', 'autre'
);
CREATE TYPE document_version_status AS ENUM ('brouillon', 'publie');

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  type          document_type NOT NULL DEFAULT 'autre',
  title         text NOT NULL,
  scope_id      uuid REFERENCES scopes(id),
  owner_user_id uuid REFERENCES users(id),
  review_due    date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_tenant_idx ON documents (tenant_id, type);

CREATE TABLE document_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  semver      text NOT NULL,
  file_ref    text,                     -- clé Object Storage (prod)
  file_name   text,
  content     bytea,                    -- contenu (stockage local MVP)
  status      document_version_status NOT NULL DEFAULT 'brouillon',
  created_by  uuid REFERENCES users(id),
  published_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_doc_semver_unique UNIQUE (document_id, semver)
);
CREATE INDEX document_versions_doc_idx ON document_versions (document_id, created_at DESC);

-- Exigences couvertes par un document (alimente la SoA, RM §5.6).
CREATE TABLE document_requirements (
  document_id    uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, requirement_id)
);

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER document_versions_set_updated_at
  BEFORE UPDATE ON document_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RM §5.6 : une version PUBLIÉE est immuable. Un trigger refuse toute
-- modification d'une ligne dont l'ancien statut est déjà « publie » (on
-- autorise seulement la transition brouillon → publie via publishVersion).
CREATE FUNCTION document_versions_freeze_published() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'publie' THEN
    RAISE EXCEPTION 'version_publiee_immuable'
      USING HINT = 'Créez une nouvelle version au lieu de modifier une version publiée.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_freeze
  BEFORE UPDATE ON document_versions FOR EACH ROW
  EXECUTE FUNCTION document_versions_freeze_published();

-- ── RLS : isolation stricte par tenant ──────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents', 'document_versions', 'document_requirements']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_versions TO toron_app;
GRANT SELECT, INSERT, DELETE ON document_requirements TO toron_app;
