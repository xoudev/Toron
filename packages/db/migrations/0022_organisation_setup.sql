-- Configuration de l'organisation et amorçage atomique d'un nouvel espace.
-- Les politiques existantes protègent également les nouvelles colonnes.
ALTER TABLE tenants ADD COLUMN employee_count integer
  CHECK (employee_count IS NULL OR employee_count BETWEEN 0 AND 100000000);
ALTER TABLE tenants ADD COLUMN sector text;

-- L'identité crée déjà tenants + memberships sous toron_auth. L'amorçage
-- ajoute le périmètre et l'audit dans LA MÊME transaction, avec SET LOCAL.
-- Aucun droit global de lecture/mutation de données métier n'est accordé.
GRANT SELECT, INSERT ON scopes TO toron_auth;
CREATE POLICY auth_bootstrap_scope_select ON scopes FOR SELECT TO toron_auth
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY auth_bootstrap_scope_insert ON scopes FOR INSERT TO toron_auth
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT INSERT ON audit_log TO toron_auth;
CREATE POLICY auth_bootstrap_audit_insert ON audit_log FOR INSERT TO toron_auth
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Retour arrière manuel : supprimer les trois politiques auth_bootstrap_*,
-- REVOKE SELECT, INSERT ON scopes FROM toron_auth;
-- REVOKE INSERT ON audit_log FROM toron_auth;
-- ALTER TABLE tenants DROP COLUMN sector, DROP COLUMN employee_count;
