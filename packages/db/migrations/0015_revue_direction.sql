-- ═══════════════════════════════════════════════════════════════════════
-- 0015 · Revue de direction (module 5.9, phase V1)
-- ═══════════════════════════════════════════════════════════════════════
-- Clause 9.3 (27001 & 9001) : UNE SEULE revue couvre le SMSI et le QMS.
-- L'ordre du jour (entrées 9.3.2) est auto-généré à partir des données réelles
-- du tenant (actions, audits, risques, KPI) — non stocké, calculé à l'affichage.
-- On persiste la séance, ses participants et ses décisions ; chaque décision
-- est convertible en action tracée (moteur commun, origin_type 'review').
-- Le procès-verbal scellé (poinçon SHA-256 + page /verifier) réutilise le
-- pipeline d'exports existant : on ajoute le type 'pv'.

ALTER TYPE export_type ADD VALUE IF NOT EXISTS 'pv';

CREATE TYPE review_status AS ENUM ('planifie', 'tenue', 'close');

CREATE TABLE management_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  title          text NOT NULL,
  scope_label    text NOT NULL DEFAULT 'SMSI + QMS',
  status         review_status NOT NULL DEFAULT 'planifie',
  held_at        date,
  next_review_at date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX management_reviews_tenant_idx ON management_reviews (tenant_id, held_at DESC);

CREATE TABLE review_participants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  review_id      uuid NOT NULL REFERENCES management_reviews(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, user_id)
);
CREATE INDEX review_participants_idx ON review_participants (review_id);

CREATE TABLE review_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  review_id      uuid NOT NULL REFERENCES management_reviews(id) ON DELETE CASCADE,
  body           text NOT NULL,
  action_id      uuid REFERENCES actions(id),   -- décision convertie en action
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX review_decisions_idx ON review_decisions (review_id, created_at);

CREATE TRIGGER management_reviews_set_updated_at
  BEFORE UPDATE ON management_reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['management_reviews', 'review_participants', 'review_decisions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON management_reviews TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON review_participants TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON review_decisions TO toron_app;
