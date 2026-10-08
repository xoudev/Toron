-- ═══════════════════════════════════════════════════════════════════════
-- 0036 · Satisfaction client (pack QMS, plan §7.3)
-- ═══════════════════════════════════════════════════════════════════════
-- Mesures de satisfaction (ISO 9001 9.1.2) : enquêtes NPS ou CSAT avec
-- leurs résultats agrégés, un objectif, les enseignements et le rapport au
-- coffre de preuves. Pas d'outil d'enquête : on consigne ce qu'un outil
-- externe a mesuré. Aucune réponse individuelle ni nom de client n'est
-- stocké (minimisation) ; les réclamations restent des non-conformités
-- de source « réclamation client », dont l'écran suit la tendance.

CREATE TABLE customer_surveys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  title           text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  method          text NOT NULL CHECK (method IN ('nps', 'csat')),
  segment         text CHECK (segment IS NULL OR length(segment) <= 200),
  closed_on       date NOT NULL,
  invited_count   integer CHECK (invited_count IS NULL OR invited_count BETWEEN 0 AND 10000000),
  respondents     integer NOT NULL CHECK (respondents BETWEEN 1 AND 10000000),
  -- NPS : répartition des répondants (0-6 détracteurs, 7-8 passifs, 9-10 promoteurs).
  promoters       integer CHECK (promoters IS NULL OR promoters >= 0),
  passives        integer CHECK (passives IS NULL OR passives >= 0),
  detractors      integer CHECK (detractors IS NULL OR detractors >= 0),
  -- CSAT : répondants satisfaits (4 ou 5 sur 5).
  satisfied       integer CHECK (satisfied IS NULL OR satisfied >= 0),
  -- Objectif : NPS entre -100 et 100, CSAT en pourcentage.
  target          integer CHECK (target IS NULL OR target BETWEEN -100 AND 100),
  findings        text CHECK (findings IS NULL OR length(findings) <= 4000),
  evidence_id     uuid,
  owner_user_id   uuid REFERENCES users(id),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Les répondants ne dépassent pas les invités.
  CONSTRAINT customer_surveys_respondents CHECK (invited_count IS NULL OR respondents <= invited_count),
  -- Chaque méthode a ses résultats, et seulement les siens.
  CONSTRAINT customer_surveys_results CHECK (
    (method = 'nps' AND satisfied IS NULL AND promoters IS NOT NULL AND passives IS NOT NULL AND detractors IS NOT NULL
       AND promoters + passives + detractors = respondents)
    OR (method = 'csat' AND promoters IS NULL AND passives IS NULL AND detractors IS NULL
       AND satisfied IS NOT NULL AND satisfied <= respondents)
  ),
  CONSTRAINT customer_surveys_target CHECK (target IS NULL OR method = 'nps' OR target >= 0),
  FOREIGN KEY (evidence_id, tenant_id) REFERENCES evidences (id, tenant_id) ON DELETE SET NULL (evidence_id)
);
CREATE INDEX customer_surveys_tenant_idx ON customer_surveys (tenant_id, closed_on DESC);
CREATE TRIGGER customer_surveys_set_updated_at
  BEFORE UPDATE ON customer_surveys FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE customer_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_surveys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_surveys FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON customer_surveys TO toron_app;

-- Les réclamations se lisent par date d'ouverture.
CREATE INDEX nonconformities_source_idx ON nonconformities (tenant_id, source, opened_at);

ALTER TABLE tenants DROP CONSTRAINT tenants_disabled_modules_known;
ALTER TABLE tenants ADD CONSTRAINT tenants_disabled_modules_known CHECK (disabled_modules <@ ARRAY[
  'risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
  'revue_direction', 'processus', 'non_conformites', 'derogations', 'sensibilisation', 'continuite', 'satisfaction'
]::text[]);

-- Retour arrière manuel :
-- ALTER TABLE tenants DROP CONSTRAINT tenants_disabled_modules_known, ADD CONSTRAINT tenants_disabled_modules_known
--   CHECK (disabled_modules <@ ARRAY['risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
--          'revue_direction', 'processus', 'non_conformites', 'derogations', 'sensibilisation', 'continuite']::text[]);
-- DROP INDEX nonconformities_source_idx;
-- DROP TABLE customer_surveys;
