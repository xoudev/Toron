-- ═══════════════════════════════════════════════════════════════════════
-- 0019 · Visibilité des référentiels par tenant (module 5.2, finitions)
-- ═══════════════════════════════════════════════════════════════════════
-- Le catalogue intégré propose de nombreux référentiels ; une organisation
-- masque ceux qui ne la concernent pas (RGPD si hors UE, DORA si non finance,
-- etc.) sans les supprimer — elle peut les rétablir à tout moment. On stocke
-- uniquement les référentiels EXPLICITEMENT masqués par le tenant.

CREATE TABLE framework_visibility (
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  framework_id   uuid NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  hidden         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, framework_id)
);

ALTER TABLE framework_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE framework_visibility FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON framework_visibility FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON framework_visibility TO toron_app;
