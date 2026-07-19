-- ═══════════════════════════════════════════════════════════════════════
-- 0017 · Ateliers EBIOS RM (module 5.4b, méthode ANSSI — phase V1)
-- ═══════════════════════════════════════════════════════════════════════
-- Étude EBIOS RM à cinq ateliers (cadrage & socle, sources de risque,
-- scénarios stratégiques, scénarios opérationnels, traitement). Le cœur
-- opérant est l'atelier 4 : chaque scénario opérationnel hérite d'un couple
-- source de risque / objectif visé (atelier 2) et se construit en kill chain
-- « Connaître → Rentrer → Trouver → Exploiter » ; la vraisemblance se dérive
-- de la complétude des phases (packages/core). L'atelier 5 génère le risque
-- dans le registre UNIQUE (source 'ebios') — pas de second référentiel.
-- EBIOS RM et ATT&CK sont publics ; aucun texte normatif propriétaire.

CREATE TYPE ebios_scenario_kind AS ENUM ('strategique', 'operationnel');
CREATE TYPE ebios_phase AS ENUM ('connaitre', 'rentrer', 'trouver', 'exploiter');
CREATE TYPE ebios_likelihood AS ENUM ('v1', 'v2', 'v3', 'v4');

CREATE TABLE ebios_studies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  title          text NOT NULL,
  scope_id       uuid REFERENCES scopes(id),
  workshop       smallint NOT NULL DEFAULT 1,   -- atelier courant (1..5)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ebios_studies_tenant_idx ON ebios_studies (tenant_id, created_at DESC);

CREATE TABLE ebios_scenarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  study_id       uuid NOT NULL REFERENCES ebios_studies(id) ON DELETE CASCADE,
  kind           ebios_scenario_kind NOT NULL DEFAULT 'operationnel',
  risk_source    text NOT NULL,                 -- source de risque (atelier 2)
  target_objective text NOT NULL,               -- objectif visé (atelier 2)
  likelihood     ebios_likelihood,              -- vraisemblance (null tant que non cotée)
  generated_risk_id uuid REFERENCES risks(id),  -- risque généré (atelier 5)
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ebios_scenarios_idx ON ebios_scenarios (study_id, created_at);

CREATE TABLE ebios_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  scenario_id    uuid NOT NULL REFERENCES ebios_scenarios(id) ON DELETE CASCADE,
  phase          ebios_phase NOT NULL,
  position       integer NOT NULL DEFAULT 0,
  mitre_id       text,                          -- technique ATT&CK (ex. T1566)
  mitre_name     text,
  label          text NOT NULL,                 -- action élémentaire
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ebios_actions_idx ON ebios_actions (scenario_id, phase, position);

CREATE TRIGGER ebios_studies_set_updated_at
  BEFORE UPDATE ON ebios_studies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ebios_studies', 'ebios_scenarios', 'ebios_actions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ebios_studies TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ebios_scenarios TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ebios_actions TO toron_app;
