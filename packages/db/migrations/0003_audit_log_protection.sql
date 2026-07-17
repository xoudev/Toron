-- ═══════════════════════════════════════════════════════════════════════
-- 0003 · Journal d'audit immuable — trigger de protection (phase M0-4)
-- ═══════════════════════════════════════════════════════════════════════
-- S6 / §8.2 : audit_log est INSERT only. Les droits (M0-2) privent déjà
-- toron_app d'UPDATE/DELETE ; ce trigger étend la garantie à TOUS les
-- rôles, y compris le propriétaire de la table et le rôle migrations —
-- l'effacement volontaire exigerait de supprimer d'abord le trigger,
-- opération visible en revue de code et dans l'historique DDL.
-- Aucune API d'effacement n'existe ni n'existera (§8.2) ; la rétention
-- paramétrable (≥ 1 an) sera un job d'archivage V1+, pas un DELETE libre.

CREATE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log est immuable (S6) : % interdit — le journal d''audit ne se modifie ni ne s''efface.',
    TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_log_immutable_row
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_immutable_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- La couche d'authentification journalise aussi (création de tenant,
-- entrées de session) : INSERT seul, pas de lecture.
CREATE POLICY audit_log_auth_insert ON audit_log FOR INSERT TO toron_auth
  WITH CHECK (true);
GRANT INSERT ON audit_log TO toron_auth;
