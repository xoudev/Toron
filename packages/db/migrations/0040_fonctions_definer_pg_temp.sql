-- ═══════════════════════════════════════════════════════════════════════
-- 0040 · Fonctions SECURITY DEFINER : pg_temp en dernier, plus de TEMP
-- ═══════════════════════════════════════════════════════════════════════
-- Quand pg_temp ne figure pas dans le search_path d'une fonction, Postgres
-- le parcourt EN PREMIER pour les tables et les vues. Un rôle runtime
-- pouvait donc créer une table temporaire homonyme (exports,
-- audit_chain_heads, supplier_requests), munie d'un trigger, puis appeler
-- la fonction : le trigger s'exécutait avec les droits du propriétaire,
-- c'est-à-dire le rôle des migrations.
--
-- Deux protections indépendantes :
-- - pg_temp placé explicitement en dernier dans le search_path de chaque
--   fonction SECURITY DEFINER (un test vérifie que toute fonction future
--   suit la règle) ;
-- - plus aucun droit TEMPORARY pour PUBLIC : aucun rôle runtime ne crée de
--   table temporaire.

ALTER FUNCTION verify_export(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION claim_next_export() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION audit_log_chain() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION audit_chain_head() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION supplier_portal_lookup(text) SET search_path = pg_catalog, public, pg_temp;

DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

-- Retour arrière manuel :
-- ALTER FUNCTION verify_export(text) SET search_path = public;
-- ALTER FUNCTION claim_next_export() SET search_path = public;
-- ALTER FUNCTION audit_log_chain() SET search_path = pg_catalog, public;
-- ALTER FUNCTION audit_chain_head() SET search_path = pg_catalog, public;
-- ALTER FUNCTION supplier_portal_lookup(text) SET search_path = pg_catalog, public;
-- DO $$ BEGIN EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO PUBLIC', current_database()); END $$;
