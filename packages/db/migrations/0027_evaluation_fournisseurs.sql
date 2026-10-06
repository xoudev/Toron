-- ═══════════════════════════════════════════════════════════════════════
-- 0027 · Évaluation des fournisseurs et attestations (module 5.10, V1)
-- ═══════════════════════════════════════════════════════════════════════
-- Une évaluation est un enregistrement daté : questionnaire rempli par
-- l'organisation, note et appréciation calculées par le cœur métier. On ne
-- la modifie pas, on en refait une — l'historique reste lisible.
-- Les attestations (certifications, rapports, assurances, DPA) portent une
-- date de validité ; leur fraîcheur suit la même règle que les preuves.
-- Les actions correctives demandées au fournisseur passent par le moteur
-- commun du plan d'action (origin_type = 'supplier').

ALTER TYPE action_origin ADD VALUE IF NOT EXISTS 'supplier';

-- Clé composite : une évaluation ou une attestation ne peut viser qu'un
-- fournisseur de la même organisation (les clés étrangères ignorent la RLS).
ALTER TABLE suppliers ADD CONSTRAINT suppliers_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE supplier_assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  supplier_id      uuid NOT NULL,
  assessed_on      date NOT NULL DEFAULT current_date,
  assessor_user_id uuid REFERENCES users(id),
  answers          jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  score            smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  rating           text NOT NULL CHECK (rating IN ('satisfaisant', 'sous_reserve', 'insuffisant')),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX supplier_assessments_supplier_idx ON supplier_assessments (supplier_id, assessed_on DESC, created_at DESC);

CREATE TABLE supplier_attestations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN (
                'iso27001', 'iso9001', 'hds', 'secnumcloud', 'soc2', 'pentest', 'assurance', 'dpa', 'autre')),
  label       text CHECK (label IS NULL OR length(label) <= 200),
  issued_on   date,
  valid_until date,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_attestations_dates CHECK (valid_until IS NULL OR issued_on IS NULL OR valid_until >= issued_on),
  FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX supplier_attestations_supplier_idx ON supplier_attestations (supplier_id, valid_until);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_assessments', 'supplier_attestations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  END LOOP;
END $$;

-- Une évaluation ne se modifie ni ne se supprime ; une attestation saisie
-- par erreur peut être retirée (le retrait est tracé au journal d'audit).
GRANT SELECT, INSERT ON supplier_assessments TO toron_app;
GRANT SELECT, INSERT, DELETE ON supplier_attestations TO toron_app;

-- Retour arrière manuel :
-- DROP TABLE supplier_attestations;
-- DROP TABLE supplier_assessments;
-- ALTER TABLE suppliers DROP CONSTRAINT suppliers_id_tenant_key;
-- La valeur 'supplier' de action_origin reste (PostgreSQL ne retire pas une
-- valeur d'énumération) ; elle est sans effet sans les écrans associés.
