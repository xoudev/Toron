-- ═══════════════════════════════════════════════════════════════════════
-- 0028 · Registre des obligations & qualification NIS 2 (module 6.4, V1)
-- ═══════════════════════════════════════════════════════════════════════
-- Chaque entité juridique porte les données de sa qualification NIS 2
-- (secteur, taille) et le suivi de son enregistrement auprès de l'ANSSI. La
-- qualification elle-même est calculée par le cœur métier ; seule une
-- qualification retenue par l'organisation (désignation, cas particulier)
-- est stockée, toujours avec sa justification.
-- Le registre des obligations recense ce qui s'impose à l'organisation
-- (NIS 2, RGPD, sectoriel, contractuel), avec responsable, statut et
-- échéance. Écarter une obligation exige une justification.

ALTER TABLE legal_entities
  ADD COLUMN nis2_sector text CHECK (nis2_sector IS NULL OR nis2_sector IN (
    'energie', 'transports', 'banque', 'marches_financiers', 'sante', 'eau_potable', 'eaux_usees',
    'infrastructure_numerique', 'services_tic', 'administration', 'espace', 'postal_expedition', 'dechets',
    'chimie', 'alimentaire', 'fabrication', 'fournisseurs_numeriques', 'recherche', 'hors_champ')),
  ADD COLUMN employee_count integer CHECK (employee_count IS NULL OR employee_count BETWEEN 0 AND 10000000),
  ADD COLUMN turnover_meur numeric(12, 1) CHECK (turnover_meur IS NULL OR turnover_meur >= 0),
  ADD COLUMN balance_sheet_meur numeric(12, 1) CHECK (balance_sheet_meur IS NULL OR balance_sheet_meur >= 0),
  ADD COLUMN nis2_override text CHECK (nis2_override IS NULL OR nis2_override IN ('ee', 'ei', 'non_concernee')),
  ADD COLUMN nis2_override_reason text,
  ADD COLUMN nis2_registration text NOT NULL DEFAULT 'a_faire'
    CHECK (nis2_registration IN ('a_faire', 'en_cours', 'enregistree', 'sans_objet')),
  ADD COLUMN nis2_registered_on date,
  ADD COLUMN nis2_reference text CHECK (nis2_reference IS NULL OR length(nis2_reference) <= 120),
  ADD CONSTRAINT legal_entities_override_justified
    CHECK (nis2_override IS NULL OR length(btrim(coalesce(nis2_override_reason, ''))) > 0),
  ADD CONSTRAINT legal_entities_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE obligations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  entity_id      uuid,
  regime         text NOT NULL CHECK (regime IN ('nis2', 'rgpd', 'sectoriel', 'contractuel', 'autre')),
  -- Clé du catalogue quand l'obligation vient d'une suggestion (évite les doublons).
  catalog_key    text,
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 300),
  source         text CHECK (source IS NULL OR length(source) <= 300),
  description    text,
  owner_user_id  uuid REFERENCES users(id),
  status         text NOT NULL DEFAULT 'a_evaluer'
                   CHECK (status IN ('a_evaluer', 'en_cours', 'conforme', 'non_applicable')),
  justification  text,
  due_date       date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligations_justified
    CHECK (status <> 'non_applicable' OR length(btrim(coalesce(justification, ''))) > 0),
  FOREIGN KEY (entity_id, tenant_id) REFERENCES legal_entities (id, tenant_id)
);
-- Une suggestion du catalogue ne s'ajoute qu'une fois par entité.
CREATE UNIQUE INDEX obligations_catalog_unique
  ON obligations (tenant_id, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), catalog_key)
  WHERE catalog_key IS NOT NULL;
CREATE INDEX obligations_tenant_idx ON obligations (tenant_id, status, due_date);

CREATE TRIGGER obligations_set_updated_at
  BEFORE UPDATE ON obligations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON obligations FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON obligations TO toron_app;

-- Retour arrière manuel :
-- DROP TABLE obligations;
-- ALTER TABLE legal_entities DROP CONSTRAINT legal_entities_id_tenant_key,
--   DROP CONSTRAINT legal_entities_override_justified,
--   DROP COLUMN nis2_reference, DROP COLUMN nis2_registered_on, DROP COLUMN nis2_registration,
--   DROP COLUMN nis2_override_reason, DROP COLUMN nis2_override, DROP COLUMN balance_sheet_meur,
--   DROP COLUMN turnover_meur, DROP COLUMN employee_count, DROP COLUMN nis2_sector;
