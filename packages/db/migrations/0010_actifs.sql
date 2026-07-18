-- ═══════════════════════════════════════════════════════════════════════
-- 0010 · Actifs & cartographie (module 6.3, phase MVP minimal — section 6)
-- ═══════════════════════════════════════════════════════════════════════
-- Inventaire simple (matériel / logiciel / données / flux) avec cotation
-- DICP (Disponibilité, Intégrité, Confidentialité, Preuve/traçabilité, 1-4)
-- et lien actif ↔ risque. Import CSV comme porte d'entrée. Jamais de CMDB
-- maison : intégrations GLPI/Intune = V3.

CREATE TYPE asset_category AS ENUM ('materiel', 'logiciel', 'donnees', 'flux');

CREATE TABLE assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  name          text NOT NULL,
  category      asset_category NOT NULL DEFAULT 'materiel',
  description   text,
  owner_user_id uuid REFERENCES users(id),
  scope_id      uuid REFERENCES scopes(id),
  -- Cotation DICP : chaque axe de 1 (négligeable) à 4 (critique).
  dicp_d        integer NOT NULL DEFAULT 1 CHECK (dicp_d BETWEEN 1 AND 4),
  dicp_i        integer NOT NULL DEFAULT 1 CHECK (dicp_i BETWEEN 1 AND 4),
  dicp_c        integer NOT NULL DEFAULT 1 CHECK (dicp_c BETWEEN 1 AND 4),
  dicp_p        integer NOT NULL DEFAULT 1 CHECK (dicp_p BETWEEN 1 AND 4),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_tenant_idx ON assets (tenant_id, category);

-- Lien actif ↔ risque (n-n).
CREATE TABLE asset_risks (
  asset_id  uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  risk_id   uuid NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, risk_id)
);

CREATE TRIGGER assets_set_updated_at
  BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS : isolation stricte par tenant ──────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assets', 'asset_risks']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON assets TO toron_app;
GRANT SELECT, INSERT, DELETE ON asset_risks TO toron_app;
