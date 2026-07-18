-- ═══════════════════════════════════════════════════════════════════════
-- 0005 · File de traitement des exports (worker Typst, module 5.3c-2)
-- ═══════════════════════════════════════════════════════════════════════
-- Le worker réclame les exports « en cours » à traiter via une fonction
-- SECURITY DEFINER : il voit les jobs de TOUS les tenants (nécessaire) sans
-- rôle BYPASSRLS au runtime (S1). Le claim est atomique (FOR UPDATE SKIP
-- LOCKED) : plusieurs workers ne prennent jamais le même job. Le traitement
-- réel (lecture des données, scellage) repasse par withTenant du tenant du
-- job — l'isolation reste entière.
--
-- Choix MVP : la table exports sert de file (un seul type de job). pg-boss
-- (ADR-7) sera introduit quand d'autres jobs asynchrones existeront
-- (e-mails, relances, fraîcheur des preuves).

ALTER TYPE export_status ADD VALUE 'en_traitement';

CREATE FUNCTION claim_next_export()
RETURNS TABLE (id uuid, tenant_id uuid, object_ref uuid, type export_type)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE exports e
  SET status = 'en_traitement', updated_at = now()
  WHERE e.id = (
    SELECT e2.id FROM exports e2
    WHERE e2.status = 'en_cours'
    ORDER BY e2.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING e.id, e.tenant_id, e.object_ref, e.type;
END
$$;

REVOKE ALL ON FUNCTION claim_next_export() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_next_export() TO toron_app;
