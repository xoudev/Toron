-- ═══════════════════════════════════════════════════════════════════════
-- 0040 · Fonctions SECURITY DEFINER : pg_temp en dernier, plus de TEMP
-- ═══════════════════════════════════════════════════════════════════════
-- Quand pg_temp ne figure pas dans le search_path d'une fonction, Postgres
-- le parcourt EN PREMIER pour les tables, les vues et les types. Un rôle
-- runtime pouvait donc créer une table temporaire homonyme (exports,
-- audit_chain_heads, supplier_requests), munie d'un trigger, puis appeler
-- la fonction ou insérer dans audit_log : le trigger s'exécutait avec les
-- droits du propriétaire, c'est-à-dire le rôle des migrations.
--
-- Deux protections indépendantes :
-- - pg_temp placé explicitement en dernier dans le search_path de chaque
--   fonction SECURITY DEFINER (un test vérifie que toute fonction future
--   suit la règle) ;
-- - aucun droit de création pour les rôles runtime : ni objet temporaire,
--   ni schéma, ni objet dans public (le défaut depuis PostgreSQL 15, rendu
--   explicite). Aucun composant ne crée de table temporaire.

ALTER FUNCTION verify_export(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION claim_next_export() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION audit_log_chain() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION audit_chain_head() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION supplier_portal_lookup(text) SET search_path = pg_catalog, public, pg_temp;

-- Rôles runtime (et leurs logins) qui gardent un droit de création. Vide sur
-- une base saine. Appelée ici et après chaque passage des migrations : une
-- base restaurée sans ses droits de base (pg_dump sans --create) les
-- rendrait à PUBLIC sans que rien ne le signale.
CREATE FUNCTION runtime_privilege_leaks()
RETURNS TABLE (role_name name, privilege text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH runtime AS (
    SELECT DISTINCT r.oid, r.rolname
    FROM pg_roles r JOIN pg_roles g ON g.rolname IN ('toron_app', 'toron_auth', 'toron_mail')
    WHERE NOT r.rolsuper AND pg_has_role(r.oid, g.oid, 'USAGE')
  )
  SELECT rolname, 'TEMPORARY' FROM runtime WHERE has_database_privilege(oid, current_database(), 'TEMPORARY')
  UNION ALL
  SELECT rolname, 'CREATE' FROM runtime WHERE has_database_privilege(oid, current_database(), 'CREATE')
  UNION ALL
  SELECT rolname, 'CREATE ON SCHEMA public' FROM runtime WHERE has_schema_privilege(oid, 'public', 'CREATE')
  ORDER BY 1, 2
$$;
REVOKE ALL ON FUNCTION runtime_privilege_leaks() FROM PUBLIC;

-- Un REVOKE fait par un rôle qui ne possède pas la base n'a aucun effet
-- (simple avertissement) : la vérification qui suit fait alors échouer la
-- migration au lieu de la laisser passer.
DO $$
DECLARE
  leaks text;
BEGIN
  EXECUTE format('REVOKE TEMPORARY, CREATE ON DATABASE %I FROM PUBLIC, toron_app, toron_auth', current_database());
  REVOKE CREATE ON SCHEMA public FROM PUBLIC, toron_app, toron_auth;
  SELECT string_agg(l.role_name || ' (' || l.privilege || ')', ', ') INTO leaks FROM runtime_privilege_leaks() l;
  IF leaks IS NOT NULL THEN
    RAISE EXCEPTION 'droits de création encore accordés aux rôles runtime : %', leaks
      USING HINT = format('Lancer les migrations avec le propriétaire de la base (%s), ou lui faire retirer ces droits.',
                          (SELECT pg_get_userbyid(d.datdba) FROM pg_database d WHERE d.datname = current_database()));
  END IF;
END
$$;

-- Retour arrière manuel :
-- ALTER FUNCTION verify_export(text) SET search_path = public;
-- ALTER FUNCTION claim_next_export() SET search_path = public;
-- ALTER FUNCTION audit_log_chain() SET search_path = pg_catalog, public;
-- ALTER FUNCTION audit_chain_head() SET search_path = pg_catalog, public;
-- ALTER FUNCTION supplier_portal_lookup(text) SET search_path = pg_catalog, public;
-- DROP FUNCTION runtime_privilege_leaks();
-- DO $$ BEGIN EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO PUBLIC', current_database()); END $$;
