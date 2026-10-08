-- ═══════════════════════════════════════════════════════════════════════
-- 0037 · Chaînage du journal d'audit (plan §8.2, V2)
-- ═══════════════════════════════════════════════════════════════════════
-- Le journal est déjà en écriture seule (0003). Le chaînage rend en plus
-- toute altération détectable, y compris par quelqu'un qui contournerait
-- l'application avec des droits directs sur la base : chaque entrée porte
-- son numéro d'ordre dans l'organisation et une empreinte SHA-256 qui
-- couvre son contenu et l'empreinte de l'entrée précédente.
--
--   hash = sha256(prev_hash ␟ seq ␟ tenant_id ␟ at en microsecondes ␟
--                 acteur ␟ action ␟ type d'objet ␟ objet ␟ before ␟ after ␟
--                 ip ␟ user agent)          (␟ = caractère 31, UTF-8)
--
-- La première entrée d'une organisation chaîne sur 64 zéros. La tête de
-- chaîne (dernier numéro, dernière empreinte) est tenue à part, hors de
-- portée des rôles applicatifs : effacer les dernières entrées se voit
-- aussi. Une modification, une insertion ou une suppression au milieu de
-- la chaîne casse la vérification à partir de l'entrée touchée.

ALTER TABLE audit_log ADD COLUMN seq bigint, ADD COLUMN prev_hash text, ADD COLUMN hash text;

-- Empreinte canonique d'une entrée. Les mêmes règles servent au calcul et
-- à la vérification ; un auditeur peut les rejouer à partir d'un export.
CREATE FUNCTION audit_log_entry_hash(
  prev_hash text, seq bigint, tenant_id uuid, at timestamptz, actor_user_id uuid, action text, object_type text,
  object_id uuid, before jsonb, after jsonb, ip inet, user_agent text
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(concat_ws(chr(31),
    prev_hash, seq::text, tenant_id::text, (extract(epoch FROM at) * 1000000)::bigint::text,
    coalesce(actor_user_id::text, ''), action, object_type, coalesce(object_id::text, ''),
    coalesce(before::text, ''), coalesce(after::text, ''), coalesce(host(ip), ''), coalesce(user_agent, '')
  ), 'UTF8')), 'hex')
$$;

-- Tête de chaîne par organisation. Aucun rôle applicatif n'y a accès : seules
-- les fonctions ci-dessous (SECURITY DEFINER, chemin de recherche fixé) la
-- lisent ou l'avancent. La RLS est active et forcée comme sur toute table
-- d'organisation ; la politique ouverte n'ouvre rien, faute de droits.
CREATE TABLE audit_chain_heads (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id),
  seq        bigint NOT NULL CHECK (seq >= 0),
  hash       text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_chain_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY chain_maintenance ON audit_chain_heads FOR ALL USING (true) WITH CHECK (true);
REVOKE ALL ON audit_chain_heads FROM PUBLIC;

-- Chaînage à l'insertion : numéro suivant, empreinte de la tête, nouvelle
-- tête. Le verrou sur la ligne de tête sérialise les insertions d'une même
-- organisation ; les valeurs fournies par l'appelant sont ignorées.
CREATE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  head record;
BEGIN
  INSERT INTO audit_chain_heads (tenant_id, seq, hash) VALUES (NEW.tenant_id, 0, repeat('0', 64))
    ON CONFLICT (tenant_id) DO NOTHING;
  SELECT h.seq, h.hash INTO head FROM audit_chain_heads h WHERE h.tenant_id = NEW.tenant_id FOR UPDATE;
  NEW.seq := head.seq + 1;
  NEW.prev_hash := head.hash;
  NEW.hash := audit_log_entry_hash(NEW.prev_hash, NEW.seq, NEW.tenant_id, NEW.at, NEW.actor_user_id, NEW.action,
                                   NEW.object_type, NEW.object_id, NEW.before, NEW.after, NEW.ip, NEW.user_agent);
  UPDATE audit_chain_heads SET seq = NEW.seq, hash = NEW.hash, updated_at = now() WHERE tenant_id = NEW.tenant_id;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION audit_log_chain() FROM PUBLIC;

-- Tête de chaîne de l'organisation courante, pour la vérification.
CREATE FUNCTION audit_chain_head() RETURNS TABLE (seq bigint, hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT h.seq, h.hash FROM audit_chain_heads h WHERE h.tenant_id = current_setting('app.tenant_id')::uuid
$$;
REVOKE ALL ON FUNCTION audit_chain_head() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_chain_head() TO toron_app;

-- Reprise de l'existant : chaque organisation chaîne ses entrées dans l'ordre
-- chronologique. Seule opération de mise à jour jamais faite sur le journal,
-- le temps de la migration, trigger d'immuabilité suspendu puis rétabli.
ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable_row;
DO $$
DECLARE
  r record;
  current_tenant uuid := NULL;
  n bigint := 0;
  prev text := repeat('0', 64);
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY tenant_id, at, id LOOP
    IF current_tenant IS DISTINCT FROM r.tenant_id THEN
      IF current_tenant IS NOT NULL THEN
        INSERT INTO audit_chain_heads (tenant_id, seq, hash) VALUES (current_tenant, n, prev);
      END IF;
      current_tenant := r.tenant_id;
      n := 0;
      prev := repeat('0', 64);
    END IF;
    n := n + 1;
    UPDATE audit_log
      SET seq = n, prev_hash = prev,
          hash = audit_log_entry_hash(prev, n, r.tenant_id, r.at, r.actor_user_id, r.action, r.object_type, r.object_id,
                                      r.before, r.after, r.ip, r.user_agent)
      WHERE id = r.id
      RETURNING audit_log.hash INTO prev;
  END LOOP;
  IF current_tenant IS NOT NULL THEN
    INSERT INTO audit_chain_heads (tenant_id, seq, hash) VALUES (current_tenant, n, prev);
  END IF;
END
$$;
ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable_row;

ALTER TABLE audit_log
  ALTER COLUMN seq SET NOT NULL,
  ALTER COLUMN prev_hash SET NOT NULL,
  ALTER COLUMN hash SET NOT NULL,
  ADD CONSTRAINT audit_log_tenant_seq UNIQUE (tenant_id, seq);

CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- Retour arrière manuel :
-- DROP TRIGGER audit_log_chain ON audit_log;
-- ALTER TABLE audit_log DROP CONSTRAINT audit_log_tenant_seq;
-- ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable_row;
-- ALTER TABLE audit_log DROP COLUMN seq, DROP COLUMN prev_hash, DROP COLUMN hash;
-- ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable_row;
-- DROP FUNCTION audit_chain_head(); DROP FUNCTION audit_log_chain(); DROP FUNCTION audit_log_entry_hash(
--   text, bigint, uuid, timestamptz, uuid, text, text, uuid, jsonb, jsonb, inet, text);
-- DROP TABLE audit_chain_heads;
