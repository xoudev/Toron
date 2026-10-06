-- ═══════════════════════════════════════════════════════════════════════
-- 0029 · Registre des activités de traitement (RGPD art. 30, module 6.4)
-- ═══════════════════════════════════════════════════════════════════════
-- Registre simple du responsable de traitement : finalité, base légale,
-- personnes et données concernées, destinataires, transferts hors UE,
-- durée de conservation, mesures de sécurité. Les sous-traitants sont des
-- fournisseurs du registre des tiers : leur accord de traitement (art. 28)
-- se lit dans leurs attestations, saisi une seule fois.
-- L'analyse d'impact complète reste hors périmètre (PLAN §11).

CREATE TABLE processing_activities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  entity_id            uuid,
  name                 text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  purpose              text NOT NULL CHECK (length(btrim(purpose)) > 0),
  legal_basis          text NOT NULL CHECK (legal_basis IN (
                         'consentement', 'contrat', 'obligation_legale', 'interets_vitaux',
                         'mission_publique', 'interet_legitime')),
  legal_basis_detail   text,
  data_subjects        text[] NOT NULL DEFAULT '{}',
  data_categories      text[] NOT NULL DEFAULT '{}',
  sensitive_data       boolean NOT NULL DEFAULT false,
  recipients           text,
  transfers_outside_eu boolean NOT NULL DEFAULT false,
  transfer_safeguards  text,
  retention            text,
  security_measures    text,
  owner_user_id        uuid REFERENCES users(id),
  last_reviewed_on     date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT processing_transfers_framed
    CHECK (NOT transfers_outside_eu OR length(btrim(coalesce(transfer_safeguards, ''))) > 0),
  CONSTRAINT processing_id_tenant_key UNIQUE (id, tenant_id),
  FOREIGN KEY (entity_id, tenant_id) REFERENCES legal_entities (id, tenant_id)
);
CREATE INDEX processing_activities_tenant_idx ON processing_activities (tenant_id, name);

CREATE TRIGGER processing_activities_set_updated_at
  BEFORE UPDATE ON processing_activities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sous-traitants d'un traitement : des fournisseurs de la même organisation.
CREATE TABLE processing_processors (
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  processing_id uuid NOT NULL,
  supplier_id   uuid NOT NULL,
  PRIMARY KEY (processing_id, supplier_id),
  FOREIGN KEY (processing_id, tenant_id) REFERENCES processing_activities (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX processing_processors_supplier_idx ON processing_processors (supplier_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['processing_activities', 'processing_processors']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON processing_activities TO toron_app;
GRANT SELECT, INSERT, DELETE ON processing_processors TO toron_app;

-- Retour arrière manuel :
-- DROP TABLE processing_processors;
-- DROP TABLE processing_activities;
