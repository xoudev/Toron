-- ═══════════════════════════════════════════════════════════════════════
-- 0014 · Audits internes (module 5.8, phase V1)
-- ═══════════════════════════════════════════════════════════════════════
-- Programme d'audit, constats typés, conversion constat → action (moteur
-- commun, origin_type 'finding'). RM §5.8 : séparation des tâches — l'auditeur
-- affecté ne peut être l'audité (contrôle applicatif). Rapport scellé = via le
-- module d'export existant (poinçon), branché ultérieurement.

CREATE TYPE audit_status AS ENUM ('planifie', 'en_cours', 'clos');
CREATE TYPE finding_type AS ENUM ('conforme', 'observation', 'nc_mineure', 'nc_majeure');

CREATE TABLE audits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  title          text NOT NULL,
  framework_id   uuid REFERENCES frameworks(id),
  scope_id       uuid REFERENCES scopes(id),
  status         audit_status NOT NULL DEFAULT 'planifie',
  planned_at     date,
  lead_auditor   uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audits_tenant_idx ON audits (tenant_id, status, planned_at DESC);

CREATE TABLE audit_findings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  audit_id       uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  requirement_ref text,
  type           finding_type NOT NULL DEFAULT 'observation',
  description    text NOT NULL,
  action_id      uuid REFERENCES actions(id),   -- constat converti en action
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_findings_idx ON audit_findings (audit_id);

CREATE TRIGGER audits_set_updated_at
  BEFORE UPDATE ON audits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audits', 'audit_findings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON audits TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_findings TO toron_app;
