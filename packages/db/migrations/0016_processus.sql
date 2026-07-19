-- ═══════════════════════════════════════════════════════════════════════
-- 0016 · Processus (module 7.1, pack QMS — phase V2)
-- ═══════════════════════════════════════════════════════════════════════
-- Cartographie des processus (ISO 9001 §4.4) : familles Management /
-- Réalisation / Support, cartouche SIPOC, indicateurs, exigences couvertes
-- (le fil orange marque un contrôle 27001 adossé — mutualisation sécurité ⇄
-- qualité), risques liés (rattachés au registre unique) et interactions.
-- La santé du processus est DÉRIVÉE des indicateurs (packages/core), non
-- stockée. Les blocs SIPOC / KPI / exigences / interactions sont en jsonb.

CREATE TYPE process_family AS ENUM ('management', 'realisation', 'support');
CREATE TYPE process_workflow AS ENUM ('brouillon', 'relecture', 'approuve', 'publie');

CREATE TABLE processes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  family         process_family NOT NULL,
  name           text NOT NULL,
  pilot_user_id  uuid REFERENCES users(id),
  version        text NOT NULL DEFAULT 'v1.0',
  workflow       process_workflow NOT NULL DEFAULT 'brouillon',
  sipoc          jsonb NOT NULL DEFAULT '{}'::jsonb,
  kpis           jsonb NOT NULL DEFAULT '[]'::jsonb,
  covered_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  interactions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processes_tenant_idx ON processes (tenant_id, family, name);

CREATE TABLE process_risks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  process_id     uuid NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  risk_id        uuid NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (process_id, risk_id)
);
CREATE INDEX process_risks_idx ON process_risks (process_id);

CREATE TRIGGER processes_set_updated_at
  BEFORE UPDATE ON processes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['processes', 'process_risks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON processes TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON process_risks TO toron_app;
