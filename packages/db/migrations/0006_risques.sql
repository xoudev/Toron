-- ═══════════════════════════════════════════════════════════════════════
-- 0006 · Moteur de risques — registre manuel (module 5.4, phase MVP)
-- ═══════════════════════════════════════════════════════════════════════
-- Registre complet : cotation brute / nette (résiduelle) / cible, options de
-- traitement, propriétaire, revues. La matrice G×V est configurable et
-- VERSIONNÉE par tenant (échelle append-only : la version active est la plus
-- récente ; changer d'échelle n'altère jamais l'historique, RM §5.4).
-- L'acceptation d'un risque est un objet de première classe, signé (qui,
-- quand, pourquoi, jusqu'à quand) et immuable. EBIOS RM guidé = phase V1.

CREATE TYPE risk_treatment AS ENUM ('reduire', 'transferer', 'accepter', 'eviter');
CREATE TYPE risk_source AS ENUM ('manual', 'ebios');
-- Bandes de la matrice (résultat d'une cotation G×V) — du plus faible au pire.
CREATE TYPE risk_band AS ENUM ('faible', 'moyen', 'eleve', 'critique');

-- ── Échelles G/V versionnées (append-only) ──────────────────────────────
-- Une échelle décrit la taille de la matrice, les libellés des niveaux de
-- gravité (g_labels) et de vraisemblance (v_labels), et la bande de risque
-- pour chaque cellule (bands : tableau JSON [g][v], indices 1..size). La
-- version active d'un tenant = MAX(version). On n'écrase jamais une version :
-- une nouvelle cotation référence la version en vigueur au moment du calcul.
CREATE TABLE risk_scales (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  version    integer NOT NULL,
  size       integer NOT NULL DEFAULT 4 CHECK (size BETWEEN 2 AND 6),
  g_labels   jsonb NOT NULL,   -- ["Négligeable", "Limitée", …] (size éléments)
  v_labels   jsonb NOT NULL,   -- ["Minimale", "Significative", …]
  bands      jsonb NOT NULL,   -- [[ "faible", … ], …] (size × size)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_scales_tenant_version_unique UNIQUE (tenant_id, version)
);

-- ── Risques ─────────────────────────────────────────────────────────────
CREATE TABLE risks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  scope_id        uuid NOT NULL REFERENCES scopes(id),
  title           text NOT NULL,
  business_value  text,                    -- valeur métier menacée
  asset_ref       uuid,                    -- actif concerné (module 6.3, optionnel)
  scenario        text,                    -- scénario de risque
  source          risk_source NOT NULL DEFAULT 'manual',
  -- Cotation brute (inhérente) et nette (résiduelle après contrôles). Bornes
  -- larges en base ; la contrainte fine (≤ taille d'échelle) est applicative.
  gross_g         integer NOT NULL CHECK (gross_g BETWEEN 1 AND 6),
  gross_v         integer NOT NULL CHECK (gross_v BETWEEN 1 AND 6),
  net_g           integer NOT NULL CHECK (net_g BETWEEN 1 AND 6),
  net_v           integer NOT NULL CHECK (net_v BETWEEN 1 AND 6),
  treatment       risk_treatment NOT NULL DEFAULT 'reduire',
  residual_target risk_band,               -- niveau résiduel visé (objectif)
  owner_user_id   uuid REFERENCES users(id),
  next_review     date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risks_tenant_scope_idx ON risks (tenant_id, scope_id);

-- ── Acceptations formelles (première classe, signées, immuables) ─────────
-- Une revalidation crée une NOUVELLE ligne ; l'acceptation en vigueur est la
-- plus récente. On ne modifie ni ne supprime une signature (append-only).
CREATE TABLE risk_acceptances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  risk_id          uuid NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  accepted_by_user uuid NOT NULL REFERENCES users(id),
  -- clock_timestamp() : deux signatures successives (revalidation) restent
  -- strictement ordonnables, y compris dans une même transaction.
  accepted_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  rationale        text NOT NULL,          -- motivation de l'acceptation
  expires_at       date                    -- échéance de revalidation
);
CREATE INDEX risk_acceptances_risk_idx ON risk_acceptances (risk_id, accepted_at DESC);

-- ── Contrôles atténuant un risque (n-n) ─────────────────────────────────
CREATE TABLE risk_controls (
  risk_id    uuid NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  control_id uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (risk_id, control_id)
);

-- ── Historique des cotations (horodaté, immuable) ───────────────────────
-- Chaque re-cotation appose un instantané : valeurs G/V brutes et nettes,
-- bandes CALCULÉES au moment du rating et version d'échelle utilisée. Ainsi,
-- changer d'échelle plus tard n'altère pas l'historique (RM §5.4).
CREATE TABLE risk_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  risk_id       uuid NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  gross_g       integer NOT NULL,
  gross_v       integer NOT NULL,
  gross_band    risk_band NOT NULL,
  net_g         integer NOT NULL,
  net_v         integer NOT NULL,
  net_band      risk_band NOT NULL,
  scale_version integer NOT NULL,
  rated_by      uuid REFERENCES users(id),
  -- clock_timestamp() : instantanés successifs strictement ordonnables même
  -- au sein d'une transaction (ordre de l'historique déterministe).
  rated_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX risk_history_risk_idx ON risk_history (risk_id, rated_at DESC);

CREATE TRIGGER risks_set_updated_at
  BEFORE UPDATE ON risks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS : isolation stricte par tenant sur les cinq tables ──────────────
ALTER TABLE risk_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_scales FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk_scales FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE risks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risks FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE risk_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk_acceptances FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE risk_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk_controls FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE risk_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk_history FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ── Droits applicatifs ──────────────────────────────────────────────────
-- risks : lecture/écriture/mise à jour. Échelles, acceptations et historique
-- sont APPEND-ONLY (versions, signatures, instantanés) — aucun UPDATE/DELETE.
GRANT SELECT, INSERT, UPDATE ON risks TO toron_app;
GRANT SELECT, INSERT ON risk_scales TO toron_app;
GRANT SELECT, INSERT ON risk_acceptances TO toron_app;
GRANT SELECT, INSERT, DELETE ON risk_controls TO toron_app;
GRANT SELECT, INSERT ON risk_history TO toron_app;
