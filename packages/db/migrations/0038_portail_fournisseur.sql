-- ═══════════════════════════════════════════════════════════════════════
-- 0038 · Portail de réponse fournisseur (module 5.10, V2)
-- ═══════════════════════════════════════════════════════════════════════
-- L'organisation demande au contact d'un fournisseur de répondre lui-même
-- au questionnaire, par un lien personnel et sans compte. Le jeton du lien
-- n'est jamais stocké, seulement son empreinte SHA-256. Le portail retrouve
-- la demande par cette empreinte grâce à une fonction dédiée qui ne rend que
-- l'organisation et la demande visées ; tout le reste passe par le contexte
-- d'organisation et la RLS, comme dans l'application.
--
-- La réponse du fournisseur ne devient une évaluation qu'une fois validée
-- par l'organisation : la note est calculée à ce moment-là, par le cœur
-- métier, et l'évaluation garde le lien vers la demande.

ALTER TABLE supplier_assessments ADD CONSTRAINT supplier_assessments_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE supplier_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  supplier_id    uuid NOT NULL,
  contact_name   text NOT NULL CHECK (length(contact_name) BETWEEN 2 AND 160),
  contact_email  text NOT NULL CHECK (length(contact_email) <= 254 AND contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  message        text CHECK (message IS NULL OR length(message) <= 2000),
  token_hash     text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status         text NOT NULL DEFAULT 'envoyee'
                 CHECK (status IN ('envoyee', 'en_cours', 'soumise', 'validee', 'annulee')),
  due_on         date NOT NULL,
  expires_on     date NOT NULL CHECK (expires_on >= due_on),
  answers        jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
  comments       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(comments) = 'object'),
  requested_by   uuid REFERENCES users(id),
  submitted_at   timestamptz,
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  assessment_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_requests_token_hash_key UNIQUE (token_hash),
  CONSTRAINT supplier_requests_id_tenant_key UNIQUE (id, tenant_id),
  -- Une réponse soumise porte sa date ; une demande validée, sa revue.
  CONSTRAINT supplier_requests_submitted CHECK (status NOT IN ('soumise', 'validee') OR submitted_at IS NOT NULL),
  CONSTRAINT supplier_requests_reviewed CHECK (status <> 'validee' OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)),
  FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (assessment_id, tenant_id) REFERENCES supplier_assessments (id, tenant_id) ON DELETE SET NULL (assessment_id)
);
CREATE INDEX supplier_requests_supplier_idx ON supplier_requests (supplier_id, created_at DESC);
CREATE INDEX supplier_requests_open_idx ON supplier_requests (tenant_id, due_on) WHERE status IN ('envoyee', 'en_cours', 'soumise');

CREATE TRIGGER supplier_requests_set_updated_at
  BEFORE UPDATE ON supplier_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE supplier_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_requests FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
-- Pas de suppression : une demande s'annule, l'historique reste lisible.
GRANT SELECT, INSERT, UPDATE ON supplier_requests TO toron_app;

-- Résolution d'un lien du portail, sans contexte d'organisation : seule
-- l'empreinte exacte d'un jeton retrouve sa demande. Rien d'autre n'est
-- rendu ; l'état et le contenu se lisent ensuite sous RLS.
CREATE FUNCTION supplier_portal_lookup(p_token_hash text)
RETURNS TABLE (tenant_id uuid, request_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.tenant_id, r.id FROM supplier_requests r WHERE r.token_hash = p_token_hash
$$;
REVOKE ALL ON FUNCTION supplier_portal_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supplier_portal_lookup(text) TO toron_app;

-- Réponse reçue : le demandeur et le responsable du fournisseur sont prévenus.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('assignation', 'decision', 'reponse'));

-- Retour arrière manuel :
-- DELETE FROM notifications WHERE kind = 'reponse';
-- ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check,
--   ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('assignation', 'decision'));
-- DROP FUNCTION supplier_portal_lookup(text);
-- DROP TABLE supplier_requests;
-- ALTER TABLE supplier_assessments DROP CONSTRAINT supplier_assessments_id_tenant_key;
