-- ═══════════════════════════════════════════════════════════════════════
-- 0034 · Sensibilisation et formation
-- ═══════════════════════════════════════════════════════════════════════
-- Sessions de sensibilisation et de formation (ISO 27001 A.6.3, ISO 9001
-- 7.2 et 7.3, NIS 2 art. 20 pour les dirigeants) : date, public, nombre de
-- personnes attendues et présentes, feuille d'émargement au coffre de
-- preuves. Les salariés sont comptés, pas nommés (minimisation) ; seuls
-- les membres de l'organisation dans Toron, dont les dirigeants, peuvent
-- être cités, pour suivre leur propre formation.

CREATE TABLE training_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  kind             text NOT NULL CHECK (kind IN (
                     'sensibilisation', 'formation_dirigeants', 'phishing', 'rgpd', 'qualite', 'metier')),
  held_on          date NOT NULL,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 2880),
  audience         text CHECK (audience IS NULL OR length(audience) <= 300),
  expected_count   integer CHECK (expected_count IS NULL OR expected_count BETWEEN 0 AND 100000),
  attended_count   integer CHECK (attended_count IS NULL OR attended_count BETWEEN 0 AND 100000),
  provider         text CHECK (provider IS NULL OR length(provider) <= 200),
  notes            text CHECK (notes IS NULL OR length(notes) <= 4000),
  evidence_id      uuid,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_sessions_id_tenant_key UNIQUE (id, tenant_id),
  -- Feuille d'émargement ou attestation : une preuve de la même organisation.
  FOREIGN KEY (evidence_id, tenant_id) REFERENCES evidences (id, tenant_id) ON DELETE SET NULL (evidence_id)
);
CREATE INDEX training_sessions_tenant_idx ON training_sessions (tenant_id, held_on DESC);

CREATE TRIGGER training_sessions_set_updated_at
  BEFORE UPDATE ON training_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Membres de l'organisation présents à une session (dirigeants notamment).
-- L'historique survit au départ d'un membre : la clé vise l'utilisateur.
CREATE TABLE training_attendees (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id, tenant_id) REFERENCES training_sessions (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX training_attendees_user_idx ON training_attendees (tenant_id, user_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_sessions', 'training_attendees']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON training_sessions TO toron_app;
GRANT SELECT, INSERT, DELETE ON training_attendees TO toron_app;

-- Le module se masque comme les autres modules optionnels.
ALTER TABLE tenants DROP CONSTRAINT tenants_disabled_modules_known;
ALTER TABLE tenants ADD CONSTRAINT tenants_disabled_modules_known CHECK (disabled_modules <@ ARRAY[
  'risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
  'revue_direction', 'processus', 'non_conformites', 'derogations', 'sensibilisation'
]::text[]);

-- Retour arrière manuel :
-- ALTER TABLE tenants DROP CONSTRAINT tenants_disabled_modules_known, ADD CONSTRAINT tenants_disabled_modules_known
--   CHECK (disabled_modules <@ ARRAY['risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
--          'revue_direction', 'processus', 'non_conformites', 'derogations']::text[]);
-- DROP TABLE training_attendees;
-- DROP TABLE training_sessions;
