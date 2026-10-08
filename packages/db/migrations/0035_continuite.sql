-- ═══════════════════════════════════════════════════════════════════════
-- 0035 · Continuité d'activité
-- ═══════════════════════════════════════════════════════════════════════
-- Bilan d'impact (BIA) des activités critiques : criticité, durée
-- maximale d'interruption admissible (DMIA, RTO), perte de données
-- maximale admissible (PDMA, RPO), mode dégradé, dépendances (actifs,
-- fournisseurs), plan de continuité rattaché. Exercices et tests (ISO 27001
-- A.5.29, A.5.30 et A.8.14, NIS 2 art. 21 §2 c) : date, activités
-- couvertes, durée de reprise mesurée, résultat, enseignements, rapport au
-- coffre de preuves. Un objectif manqué se documente et ouvre des actions.

ALTER TABLE processes ADD CONSTRAINT processes_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE documents ADD CONSTRAINT documents_id_tenant_key UNIQUE (id, tenant_id);

-- Action corrective issue d'un exercice de continuité.
ALTER TYPE action_origin ADD VALUE 'exercise';

CREATE TABLE continuity_activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  description      text CHECK (description IS NULL OR length(description) <= 2000),
  owner_user_id    uuid REFERENCES users(id),
  process_id       uuid,
  -- 1 faible · 2 modérée · 3 forte · 4 vitale
  criticality      smallint NOT NULL CHECK (criticality BETWEEN 1 AND 4),
  rto_hours        integer NOT NULL CHECK (rto_hours BETWEEN 0 AND 8760),
  rpo_hours        integer NOT NULL CHECK (rpo_hours BETWEEN 0 AND 8760),
  degraded_mode    text CHECK (degraded_mode IS NULL OR length(degraded_mode) <= 4000),
  plan_document_id uuid,
  assessed_on      date NOT NULL,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT continuity_activities_id_tenant_key UNIQUE (id, tenant_id),
  FOREIGN KEY (process_id, tenant_id) REFERENCES processes (id, tenant_id) ON DELETE SET NULL (process_id),
  FOREIGN KEY (plan_document_id, tenant_id) REFERENCES documents (id, tenant_id) ON DELETE SET NULL (plan_document_id)
);
CREATE INDEX continuity_activities_tenant_idx ON continuity_activities (tenant_id, criticality DESC, name);
CREATE TRIGGER continuity_activities_set_updated_at
  BEFORE UPDATE ON continuity_activities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Dépendances d'une activité : actifs et fournisseurs de la même organisation.
CREATE TABLE continuity_activity_assets (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  activity_id uuid NOT NULL,
  asset_id    uuid NOT NULL,
  PRIMARY KEY (activity_id, asset_id),
  FOREIGN KEY (activity_id, tenant_id) REFERENCES continuity_activities (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE
);
CREATE TABLE continuity_activity_suppliers (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  activity_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  PRIMARY KEY (activity_id, supplier_id),
  FOREIGN KEY (activity_id, tenant_id) REFERENCES continuity_activities (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers (id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE continuity_exercises (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  title             text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  kind              text NOT NULL CHECK (kind IN ('restauration', 'bascule', 'table', 'crise', 'alerte')),
  scheduled_on      date NOT NULL,
  status            text NOT NULL DEFAULT 'planifie' CHECK (status IN ('planifie', 'realise', 'annule')),
  result            text CHECK (result IS NULL OR result IN ('atteint', 'partiel', 'non_atteint')),
  recovery_minutes  integer CHECK (recovery_minutes IS NULL OR recovery_minutes BETWEEN 0 AND 525600),
  findings          text CHECK (findings IS NULL OR length(findings) <= 4000),
  evidence_id       uuid,
  -- Pilote de l'exercice : il le prépare, le conduit et en consigne le résultat.
  lead_user_id      uuid REFERENCES users(id),
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT continuity_exercises_id_tenant_key UNIQUE (id, tenant_id),
  -- Le résultat n'existe qu'une fois l'exercice réalisé, et il est alors obligatoire.
  CONSTRAINT continuity_exercises_result CHECK ((status = 'realise') = (result IS NOT NULL)),
  CONSTRAINT continuity_exercises_recovery CHECK (status = 'realise' OR recovery_minutes IS NULL),
  -- Un objectif manqué se documente : c'est le point de départ des actions.
  CONSTRAINT continuity_exercises_findings
    CHECK (result IS NULL OR result = 'atteint' OR length(btrim(coalesce(findings, ''))) >= 10),
  FOREIGN KEY (evidence_id, tenant_id) REFERENCES evidences (id, tenant_id) ON DELETE SET NULL (evidence_id)
);
CREATE INDEX continuity_exercises_tenant_idx ON continuity_exercises (tenant_id, scheduled_on DESC);
CREATE TRIGGER continuity_exercises_set_updated_at
  BEFORE UPDATE ON continuity_exercises FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Activités couvertes par un exercice.
CREATE TABLE continuity_exercise_activities (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  exercise_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  PRIMARY KEY (exercise_id, activity_id),
  FOREIGN KEY (exercise_id, tenant_id) REFERENCES continuity_exercises (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id, tenant_id) REFERENCES continuity_activities (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX continuity_exercise_activities_activity_idx ON continuity_exercise_activities (tenant_id, activity_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'continuity_activities', 'continuity_activity_assets', 'continuity_activity_suppliers',
    'continuity_exercises', 'continuity_exercise_activities']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON continuity_activities, continuity_exercises TO toron_app;
GRANT SELECT, INSERT, DELETE ON continuity_activity_assets, continuity_activity_suppliers, continuity_exercise_activities TO toron_app;

-- Une activité critique ou un exercice confié à un membre le prévient.
ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_subject_check
  CHECK (subject IN ('action', 'risque', 'obligation', 'fournisseur', 'traitement', 'derogation', 'controle', 'activite', 'exercice'));

ALTER TABLE tenants DROP CONSTRAINT tenants_disabled_modules_known;
ALTER TABLE tenants ADD CONSTRAINT tenants_disabled_modules_known CHECK (disabled_modules <@ ARRAY[
  'risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
  'revue_direction', 'processus', 'non_conformites', 'derogations', 'sensibilisation', 'continuite'
]::text[]);

-- Retour arrière manuel (la valeur 'exercise' de action_origin reste :
-- PostgreSQL ne retire pas une valeur d'énumération) :
-- DELETE FROM notifications WHERE subject IN ('activite', 'exercice');
-- ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check, ADD CONSTRAINT notifications_subject_check
--   CHECK (subject IN ('action', 'risque', 'obligation', 'fournisseur', 'traitement', 'derogation', 'controle'));
-- ALTER TABLE tenants DROP CONSTRAINT tenants_disabled_modules_known, ADD CONSTRAINT tenants_disabled_modules_known
--   CHECK (disabled_modules <@ ARRAY['risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
--          'revue_direction', 'processus', 'non_conformites', 'derogations', 'sensibilisation']::text[]);
-- DROP TABLE continuity_exercise_activities, continuity_exercises, continuity_activity_suppliers,
--   continuity_activity_assets, continuity_activities;
-- ALTER TABLE documents DROP CONSTRAINT documents_id_tenant_key;
-- ALTER TABLE processes DROP CONSTRAINT processes_id_tenant_key;
