-- ═══════════════════════════════════════════════════════════════════════
-- 0009 · Coffre de preuves (module 5.7, phase MVP)
-- ═══════════════════════════════════════════════════════════════════════
-- Preuves horodatées, empreintées (SHA-256 à l'ingestion) et datées de
-- fraîcheur (valid_until + récurrence de collecte). Liaison n-n vers
-- exigences ET contrôles : une preuve liée à un contrôle mutualisé couvre
-- plusieurs référentiels (P1). RM §5.7 : une preuve expirée SIGNALE les
-- exigences couvertes (l'humain décide, l'outil ne change pas de statut).
-- Journal des accès append-only. Stockage bytea local (MVP) ; Object Storage
-- en prod. Antivirus (ClamAV) = V1.

CREATE TYPE evidence_type AS ENUM ('capture', 'export', 'attestation', 'rapport', 'pv');
CREATE TYPE evidence_recurrence AS ENUM ('ponctuelle', 'trimestrielle', 'semestrielle', 'annuelle');
CREATE TYPE evidence_access_kind AS ENUM ('consultation', 'telechargement');

CREATE TABLE evidences (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  title             text NOT NULL,
  type              evidence_type NOT NULL DEFAULT 'export',
  file_ref          text,
  file_name         text,
  content           bytea,
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  collected_at      date NOT NULL DEFAULT CURRENT_DATE,
  valid_until       date,
  recurrence        evidence_recurrence NOT NULL DEFAULT 'ponctuelle',
  collector_user_id uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidences_tenant_idx ON evidences (tenant_id, valid_until);

CREATE TABLE evidence_links (
  evidence_id uuid NOT NULL REFERENCES evidences(id) ON DELETE CASCADE,
  target_type action_link_target NOT NULL,     -- 'requirement' | 'control'
  target_id   uuid NOT NULL,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evidence_id, target_type, target_id)
);

-- Journal des accès (append-only) : qui a consulté / téléchargé une preuve.
CREATE TABLE evidence_access_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  evidence_id uuid NOT NULL REFERENCES evidences(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id),
  kind        evidence_access_kind NOT NULL,
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX evidence_access_log_ev_idx ON evidence_access_log (evidence_id, at DESC);

CREATE TRIGGER evidences_set_updated_at
  BEFORE UPDATE ON evidences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS : isolation stricte par tenant ──────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidences', 'evidence_links', 'evidence_access_log']
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

-- evidence_access_log : append-only (journal). evidences/links : CRUD tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON evidences TO toron_app;
GRANT SELECT, INSERT, DELETE ON evidence_links TO toron_app;
GRANT SELECT, INSERT ON evidence_access_log TO toron_app;
