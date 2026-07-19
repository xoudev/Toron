-- ═══════════════════════════════════════════════════════════════════════
-- 0013 · Tiers & fournisseurs (module 5.10, phase V1) — angle « effet cascade »
-- ═══════════════════════════════════════════════════════════════════════
-- Registre des fournisseurs avec tiering (T1 critique → T3), catégories de
-- données confiées, statut des clauses contractuelles, propriétaire et revue.
-- Campagnes de questionnaires et portail fournisseur = V2 (backlog).

CREATE TYPE supplier_tier AS ENUM ('t1', 't2', 't3');
CREATE TYPE contract_status AS ENUM ('a_faire', 'en_cours', 'conforme');

CREATE TABLE suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  name            text NOT NULL,
  tier            supplier_tier NOT NULL DEFAULT 't3',
  services        text,
  data_categories text[] NOT NULL DEFAULT '{}',
  contract_status contract_status NOT NULL DEFAULT 'a_faire',
  owner_user_id   uuid REFERENCES users(id),
  next_review     date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_tenant_idx ON suppliers (tenant_id, tier);

CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers TO toron_app;
