-- ═══════════════════════════════════════════════════════════════════════
-- 0033 · Revues d'efficacité des contrôles internes
-- ═══════════════════════════════════════════════════════════════════════
-- Un contrôle rattaché à des exigences ne prouve rien tant qu'on ne vérifie
-- pas qu'il fonctionne. Chaque revue consigne la date, la personne, la
-- méthode, le résultat et les observations, avec au besoin une preuve du
-- coffre rattachée au contrôle. L'historique ne se modifie ni ne se supprime
-- (seule la suppression du contrôle lui-même l'emporte, tracée au journal).

ALTER TABLE evidences ADD CONSTRAINT evidences_id_tenant_key UNIQUE (id, tenant_id);

-- Action corrective ouverte depuis une revue défaillante.
ALTER TYPE action_origin ADD VALUE 'control';

CREATE TABLE control_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  control_id       uuid NOT NULL,
  reviewed_on      date NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  method           text NOT NULL CHECK (method IN (
                     'revue_documentaire', 'entretien', 'observation', 'echantillonnage', 'test_technique')),
  result           text NOT NULL CHECK (result IN ('efficace', 'partiellement_efficace', 'inefficace')),
  observations     text CHECK (observations IS NULL OR length(observations) <= 4000),
  evidence_id      uuid,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Un contrôle défaillant se documente : c'est le point de départ de la correction.
  CONSTRAINT control_reviews_findings
    CHECK (result = 'efficace' OR length(btrim(coalesce(observations, ''))) >= 10),
  FOREIGN KEY (control_id, tenant_id) REFERENCES controls (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id, tenant_id) REFERENCES evidences (id, tenant_id) ON DELETE SET NULL (evidence_id)
);
CREATE INDEX control_reviews_control_idx ON control_reviews (tenant_id, control_id, reviewed_on DESC);

ALTER TABLE control_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON control_reviews FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Historique : lecture et ajout seulement.
GRANT SELECT, INSERT ON control_reviews TO toron_app;

-- Un contrôle confié à un responsable le prévient, comme les autres objets.
ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_subject_check
  CHECK (subject IN ('action', 'risque', 'obligation', 'fournisseur', 'traitement', 'derogation', 'controle'));

-- Retour arrière manuel (la valeur 'control' de action_origin reste : Postgres
-- ne retire pas une valeur d'enum ; elle est inoffensive sans écran qui l'emploie) :
-- ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check, ADD CONSTRAINT notifications_subject_check
--   CHECK (subject IN ('action', 'risque', 'obligation', 'fournisseur', 'traitement', 'derogation'));
-- DROP TABLE control_reviews;
-- ALTER TABLE evidences DROP CONSTRAINT evidences_id_tenant_key;
