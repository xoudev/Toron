-- ═══════════════════════════════════════════════════════════════════════
-- 0011 · Incidents & chronologie réglementaire NIS 2 (module 6.1, phase V1)
-- ═══════════════════════════════════════════════════════════════════════
-- Registre d'incidents, timeline IMMUABLE, qualification « incident important
-- NIS 2 » par critères, échéancier réglementaire (alerte 24 h → notification
-- 72 h → rapport J+30) + volet RGPD (CNIL 72 h). RM §6.1 : les échéances se
-- calculent à l'horodatage de QUALIFICATION (pas d'ouverture) ; la timeline
-- est append-only ; un incident qualifié important ne peut se clore sans REX.

CREATE TYPE incident_severity AS ENUM ('mineur', 'majeur', 'critique');
CREATE TYPE incident_status AS ENUM ('ouvert', 'qualifie', 'clos');
CREATE TYPE incident_notif_kind AS ENUM ('alerte_24h', 'notification_72h', 'rapport_30j', 'cnil_72h');

CREATE TABLE incidents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  title          text NOT NULL,
  description    text,
  severity       incident_severity NOT NULL DEFAULT 'mineur',
  status         incident_status NOT NULL DEFAULT 'ouvert',
  opened_at      timestamptz NOT NULL DEFAULT now(),
  qualified_at   timestamptz,               -- horodatage de qualification NIS 2
  nis2_important boolean NOT NULL DEFAULT false,
  nis2_criteria  jsonb,                     -- critères cochés à la qualification
  gdpr_breach    boolean NOT NULL DEFAULT false,
  rex            text,                      -- retour d'expérience (clôture)
  owner_user_id  uuid REFERENCES users(id),
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- RM : clôture interdite sans REX si l'incident est qualifié important.
  CONSTRAINT incidents_rex_si_important CHECK (
    status <> 'clos' OR nis2_important = false OR (rex IS NOT NULL AND length(btrim(rex)) > 0)
  )
);
CREATE INDEX incidents_tenant_idx ON incidents (tenant_id, status, opened_at DESC);

-- Timeline horodatée (append-only : trace immuable de la vie de l'incident).
CREATE TABLE incident_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  incident_id    uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  kind           text NOT NULL,             -- detection, qualification, mesure, communication…
  description    text NOT NULL,
  author_user_id uuid REFERENCES users(id)
);
CREATE INDEX incident_events_idx ON incident_events (incident_id, at);

-- Échéances réglementaires, calculées à la qualification.
CREATE TABLE incident_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind        incident_notif_kind NOT NULL,
  due_at      timestamptz NOT NULL,
  sent_at     timestamptz,
  export_ref  uuid,                          -- déclaration scellée (export)
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_notifications_unique UNIQUE (incident_id, kind)
);
CREATE INDEX incident_notifications_idx ON incident_notifications (incident_id, due_at);

CREATE TRIGGER incidents_set_updated_at
  BEFORE UPDATE ON incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS : isolation stricte par tenant ──────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incidents', 'incident_events', 'incident_notifications']
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

-- incident_events : append-only (timeline immuable). Reste : CRUD tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON incidents TO toron_app;
GRANT SELECT, INSERT ON incident_events TO toron_app;
GRANT SELECT, INSERT, UPDATE ON incident_notifications TO toron_app;
