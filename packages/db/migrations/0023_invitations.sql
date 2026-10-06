-- ═══════════════════════════════════════════════════════════════════════
-- 0023 · Invitations de membres (module 5.1) et administration des accès
-- ═══════════════════════════════════════════════════════════════════════
-- Un responsable invite une adresse e-mail avec un rôle cible. Le lien
-- d'invitation porte un jeton aléatoire dont seule l'empreinte SHA-256 est
-- stockée : la base ne permet pas de reconstituer un lien valide.
-- L'acceptation s'effectue sous le rôle d'identité (toron_auth), qui crée
-- l'appartenance dans la même transaction que la trace d'audit.

CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  email         text NOT NULL CHECK (email = lower(email)),
  role          membership_role NOT NULL DEFAULT 'lecteur',
  token_hash    text NOT NULL,
  invited_by    uuid REFERENCES users(id),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   uuid REFERENCES users(id),
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT invitations_role_not_owner CHECK (role <> 'owner')
);
CREATE INDEX invitations_tenant_idx ON invitations (tenant_id, created_at DESC);
CREATE INDEX invitations_email_idx ON invitations (email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TRIGGER invitations_set_updated_at
  BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

-- Rôle applicatif : gestion des invitations de l'organisation courante.
CREATE POLICY tenant_isolation ON invitations FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO toron_app;

-- Rôle d'identité : retrouve une invitation par empreinte de jeton ou par
-- adresse de la session (lecture), puis la marque acceptée dans le contexte
-- de l'organisation concernée. Aucune création ni suppression.
CREATE POLICY auth_invitation_select ON invitations FOR SELECT TO toron_auth
  USING (true);
CREATE POLICY auth_invitation_accept ON invitations FOR UPDATE TO toron_auth
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, UPDATE ON invitations TO toron_auth;

-- L'acceptation lit l'appartenance existante avant de la créer : la lecture
-- de memberships est déjà ouverte à toron_auth (0002), l'insertion aussi.

-- Retour arrière manuel :
-- DROP TABLE invitations;
