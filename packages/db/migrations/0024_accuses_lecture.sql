-- ═══════════════════════════════════════════════════════════════════════
-- 0024 · Accusés de lecture des documents (module 5.6, workflow documentaire)
-- ═══════════════════════════════════════════════════════════════════════
-- Un document marqué « lecture obligatoire » doit être lu et accepté par
-- chaque membre, version publiée par version publiée : une nouvelle version
-- appelle une nouvelle acceptation. L'accusé est une preuve (sensibilisation,
-- ISO 27001 A.5.1 et A.6.3) : il ne se modifie ni ne se supprime.

ALTER TABLE documents ADD COLUMN acknowledgement_required boolean NOT NULL DEFAULT false;

CREATE TABLE document_acknowledgements (
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  version_id       uuid NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id),
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, user_id)
);
CREATE INDEX document_acknowledgements_user_idx ON document_acknowledgements (tenant_id, user_id);

-- On n'accuse réception que d'une version publiée, de la même organisation.
CREATE FUNCTION document_acknowledgements_published_only() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM document_versions v
    WHERE v.id = NEW.version_id AND v.status = 'publie' AND v.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'accuse_version_non_publiee'
      USING HINT = 'Seule une version publiée peut faire l''objet d''un accusé de lecture.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_acknowledgements_check
  BEFORE INSERT ON document_acknowledgements FOR EACH ROW
  EXECUTE FUNCTION document_acknowledgements_published_only();

ALTER TABLE document_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_acknowledgements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_acknowledgements FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Lecture et création seulement : un accusé est une preuve immuable.
GRANT SELECT, INSERT ON document_acknowledgements TO toron_app;

-- Retour arrière manuel :
-- DROP TABLE document_acknowledgements;
-- DROP FUNCTION document_acknowledgements_published_only();
-- ALTER TABLE documents DROP COLUMN acknowledgement_required;
