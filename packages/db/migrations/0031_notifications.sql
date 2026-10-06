-- ═══════════════════════════════════════════════════════════════════════
-- 0031 · Centre de notifications in-app (module 5.12, V1)
-- ═══════════════════════════════════════════════════════════════════════
-- Une notification prévient un membre qu'on lui a confié un objet (action,
-- risque, obligation, fournisseur, fiche de traitement). Elle porte un lien
-- interne vers l'objet, jamais une URL arbitraire. Lue ou non lue ; elle ne
-- se supprime pas (historique), seule la date de lecture se pose.

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('assignation')),
  subject       text NOT NULL CHECK (subject IN ('action', 'risque', 'obligation', 'fournisseur', 'traitement')),
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  -- Lien interne uniquement : chemin de l'organisation, sans schéma ni hôte.
  href          text NOT NULL CHECK (href ~ '^/t/[a-z0-9-]+/[a-z0-9/?=&_-]+$'),
  actor_user_id uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at       timestamptz,
  -- Le destinataire est forcément membre de l'organisation.
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX notifications_user_idx ON notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (tenant_id, user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Lecture, création, et seule mise à jour possible : la date de lecture.
GRANT SELECT, INSERT ON notifications TO toron_app;
GRANT UPDATE (read_at) ON notifications TO toron_app;

-- Retour arrière manuel :
-- DROP TABLE notifications;
