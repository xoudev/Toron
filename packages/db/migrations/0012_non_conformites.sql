-- ═══════════════════════════════════════════════════════════════════════
-- 0012 · Non-conformités & CAPA (module 7.2, PACK QMS — section 7)
-- ═══════════════════════════════════════════════════════════════════════
-- Registre des non-conformités (interne / fournisseur / réclamation client),
-- action immédiate curative, analyse de cause racine (5 pourquoi), actions
-- correctives via le moteur COMMUN du plan d'action (origin_type = 'nc').
-- RM §7.2 (la subtilité ISO) : la clôture planifie une VÉRIFICATION
-- D'EFFICACITÉ à J+90 — statut « clôturée · efficacité à vérifier » puis
-- « efficace » ou réouverture. C'est une règle moteur, pas une convention.

CREATE TYPE nc_source AS ENUM ('interne', 'fournisseur', 'reclamation_client');
CREATE TYPE nc_gravity AS ENUM ('mineure', 'majeure', 'critique');
CREATE TYPE nc_status AS ENUM (
  'ouverte', 'en_traitement', 'cloturee_a_verifier', 'efficace', 'rouverte'
);

CREATE TABLE nonconformities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  title                 text NOT NULL,
  description           text,
  source                nc_source NOT NULL DEFAULT 'interne',
  process_ref           text,                 -- processus concerné (module Processus = V2)
  gravity               nc_gravity NOT NULL DEFAULT 'mineure',
  cost_estimate         numeric(12, 2),       -- coût de non-qualité estimé (€)
  immediate_action      text,                 -- action immédiate curative
  root_cause            jsonb,                -- 5 pourquoi (chaîne) + cause racine
  status                nc_status NOT NULL DEFAULT 'ouverte',
  opened_at             timestamptz NOT NULL DEFAULT now(),
  detected_by           uuid REFERENCES users(id),
  owner_user_id         uuid REFERENCES users(id),
  closed_at             timestamptz,
  effectiveness_check_at date,                -- vérification d'efficacité (J+90)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Cohérence : « à vérifier » ⇒ date de contrôle et date de clôture posées.
  CONSTRAINT nc_verif_complete CHECK (
    status <> 'cloturee_a_verifier' OR (closed_at IS NOT NULL AND effectiveness_check_at IS NOT NULL)
  )
);
CREATE INDEX nonconformities_tenant_idx ON nonconformities (tenant_id, status, opened_at DESC);

CREATE TRIGGER nonconformities_set_updated_at
  BEFORE UPDATE ON nonconformities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS : isolation stricte par tenant ──────────────────────────────────
ALTER TABLE nonconformities ENABLE ROW LEVEL SECURITY;
ALTER TABLE nonconformities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nonconformities FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON nonconformities TO toron_app;
