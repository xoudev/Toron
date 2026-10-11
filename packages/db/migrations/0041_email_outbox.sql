-- ═══════════════════════════════════════════════════════════════════════
-- 0041 · File d'envoi des e-mails (socle courriel)
-- ═══════════════════════════════════════════════════════════════════════
-- Les e-mails partent d'une file transactionnelle : l'application dépose,
-- le service mail réclame, envoie puis clôture. Le lien éventuel voyage
-- scellé (secret_box, AES-256-GCM côté service) et la base l'efface dès que
-- la ligne atteint un statut final : une contrainte CHECK l'impose.
--
-- Aucun rôle runtime ne touche la table directement. toron_auth dépose les
-- e-mails de compte par enqueue_account_email, qui impose tenant_id NULL et
-- applique les quotas ; le service mail (rôle toron_mail) ne passe que par
-- ses fonctions de file et ne lit rien d'autre. Ces fonctions SECURITY
-- DEFINER franchissent la RLS forcée parce que leur propriétaire est le
-- rôle des migrations, comme claim_next_export (0005). pg_temp vient en
-- dernier dans leur search_path et la table est qualifiée : une table
-- temporaire email_outbox de l'appelant, munie d'un trigger, ne peut pas
-- s'y substituer pour s'exécuter avec les droits du propriétaire.
--
-- La table n'est pas déclarée dans le schéma Drizzle : l'export des données
-- d'une organisation (exportTenantData) ne doit jamais la parcourir.

-- ── Rôle du service mail ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'toron_mail') THEN
    CREATE ROLE toron_mail NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO toron_mail;

-- ── File ────────────────────────────────────────────────────────────────
CREATE TABLE email_outbox (
  -- Fourni par l'appelant : il entre dans l'AAD du scellement.
  id                  uuid PRIMARY KEY,
  -- NULL : e-mail de compte, hors de toute organisation.
  tenant_id           uuid REFERENCES tenants(id),
  kind                text NOT NULL CHECK (kind IN ('mot_de_passe_reinitialisation', 'mot_de_passe_modifie')),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient           text NOT NULL CHECK (length(recipient) <= 254 AND recipient = lower(recipient)
                        AND recipient ~ '^[^@\s<>(),;:"]+@[^@\s<>(),;:"]+\.[^@\s<>(),;:"]+$'),
  params              jsonb NOT NULL DEFAULT '{}'
                        CHECK (jsonb_typeof(params) = 'object' AND octet_length(params::text) <= 2048),
  secret_box          bytea CHECK (secret_box IS NULL OR octet_length(secret_box) BETWEEN 29 AND 512),
  secret_key_id       text CHECK (secret_key_id IS NULL OR secret_key_id ~ '^k[0-9a-f]{8}$'),
  status              text NOT NULL DEFAULT 'a_envoyer'
                        CHECK (status IN ('a_envoyer', 'en_cours', 'envoye', 'echec', 'expire')),
  attempts            smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  not_before          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  lease_token         uuid,
  claimed_at          timestamptz,
  sent_at             timestamptz,
  provider_message_id text CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200),
  last_error_code     text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z_]{3,40}$'),
  correlation_id      uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Le secret n'existe que tant que l'envoi reste possible.
  CONSTRAINT email_outbox_secret_wiped CHECK (secret_box IS NULL OR status IN ('a_envoyer', 'en_cours')),
  CONSTRAINT email_outbox_secret_key CHECK (secret_box IS NULL OR secret_key_id IS NOT NULL),
  CONSTRAINT email_outbox_lease CHECK ((status = 'en_cours') = (lease_token IS NOT NULL)),
  CONSTRAINT email_outbox_scope CHECK ((tenant_id IS NULL) = (kind IN ('mot_de_passe_reinitialisation', 'mot_de_passe_modifie')))
);
CREATE INDEX email_outbox_due_idx ON email_outbox (not_before) WHERE status IN ('a_envoyer', 'en_cours');
CREATE INDEX email_outbox_quota_idx ON email_outbox (kind, user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX email_outbox_global_idx ON email_outbox (created_at) WHERE tenant_id IS NULL;
CREATE INDEX email_outbox_tenant_idx ON email_outbox (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;

CREATE TRIGGER email_outbox_set_updated_at
  BEFORE UPDATE ON email_outbox FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Purge des jetons Better Auth d'un compte (value = identifiant utilisateur).
CREATE INDEX verifications_value_idx ON verifications (value);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
-- Rôle applicatif : e-mails de l'organisation courante. Aucun droit de
-- table pour l'instant ; ils arriveront avec les invitations par e-mail.
CREATE POLICY tenant_isolation ON email_outbox FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ── Dépôt d'un e-mail de compte (toron_auth) ────────────────────────────
-- Quotas codés ici et non fournis par l'appelant ; packages/core les
-- reflète dans ACCOUNT_EMAIL_QUOTAS, un test vérifie qu'ils concordent.
-- Le verrou consultatif sérialise les dépôts d'un même compte : deux
-- demandes simultanées ne franchissent pas le quota ensemble. Le plafond
-- global, lui, sert de disjoncteur et peut être dépassé de quelques
-- dépôts concurrents sur des comptes distincts.
CREATE FUNCTION enqueue_account_email(
  p_id uuid, p_kind text, p_user_id uuid, p_recipient text, p_params jsonb,
  p_secret_box bytea, p_secret_key_id text, p_expires_at timestamptz, p_correlation_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  per_hour integer;
  per_day integer;
BEGIN
  IF p_kind = 'mot_de_passe_reinitialisation' THEN
    per_hour := 3;
    per_day := 5;
  ELSIF p_kind = 'mot_de_passe_modifie' THEN
    per_day := 5;
  ELSE
    RAISE EXCEPTION 'courriel_type_invalide' USING ERRCODE = '22023',
      HINT = 'Seuls les e-mails de compte passent par cette fonction.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'courriel_compte_requis' USING ERRCODE = '22023',
      HINT = 'Un e-mail de compte vise un utilisateur identifié.';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'courriel_expiration_invalide' USING ERRCODE = '22023',
      HINT = 'L''expiration doit tomber dans les 24 heures à venir.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('email_outbox:compte:' || p_user_id::text, 0));

  IF per_hour IS NOT NULL AND (
    SELECT count(*) FROM public.email_outbox o
    WHERE o.kind = p_kind AND o.user_id = p_user_id AND o.created_at > now() - interval '1 hour') >= per_hour THEN
    RETURN 'quota_compte';
  END IF;
  IF (SELECT count(*) FROM public.email_outbox o
      WHERE o.kind = p_kind AND o.user_id = p_user_id AND o.created_at > now() - interval '24 hours') >= per_day THEN
    RETURN 'quota_compte';
  END IF;
  IF (SELECT count(*) FROM public.email_outbox o
      WHERE o.tenant_id IS NULL AND o.created_at > now() - interval '1 hour') >= 200 THEN
    RETURN 'quota_global';
  END IF;

  INSERT INTO public.email_outbox (id, tenant_id, kind, user_id, recipient, params, secret_box, secret_key_id,
                            expires_at, correlation_id)
  VALUES (p_id, NULL, p_kind, p_user_id, p_recipient, coalesce(p_params, '{}'), p_secret_box, p_secret_key_id,
          p_expires_at, p_correlation_id);
  RETURN 'mis_en_file';
END
$$;

-- ── Réclamation (toron_mail) ────────────────────────────────────────────
-- Avant de réclamer : les baux échus reviennent dans la file, les lignes
-- qui ont épuisé leurs tentatives passent en échec et celles qui ne
-- peuvent plus partir à temps expirent, secret effacé. SKIP LOCKED partout :
-- deux services ne s'attendent jamais et ne prennent pas la même ligne.
CREATE FUNCTION claim_next_email(p_lease interval, p_min_margin interval, p_max_attempts integer)
RETURNS TABLE (id uuid, kind text, recipient text, params jsonb, secret_box bytea, secret_key_id text,
               attempts smallint, expires_at timestamptz, lease_token uuid, correlation_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF p_lease IS NULL OR p_lease <= interval '0' OR p_min_margin IS NULL OR p_min_margin < interval '0'
     OR p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'courriel_reclamation_invalide' USING ERRCODE = '22023',
      HINT = 'Bail positif, marge positive ou nulle, tentatives entre 1 et 10.';
  END IF;

  UPDATE public.email_outbox o
  SET status = 'a_envoyer', lease_token = NULL, last_error_code = 'BAIL_EXPIRE'
  WHERE o.id IN (
    SELECT o2.id FROM public.email_outbox o2
    WHERE o2.status = 'en_cours' AND o2.claimed_at < now() - p_lease
    FOR UPDATE SKIP LOCKED);

  UPDATE public.email_outbox o
  SET status = 'echec', secret_box = NULL, last_error_code = 'TENTATIVES_EPUISEES'
  WHERE o.id IN (
    SELECT o2.id FROM public.email_outbox o2
    WHERE o2.status = 'a_envoyer' AND o2.attempts >= p_max_attempts
    FOR UPDATE SKIP LOCKED);

  UPDATE public.email_outbox o
  SET status = 'expire', secret_box = NULL, last_error_code = 'DELAI_DEPASSE'
  WHERE o.id IN (
    SELECT o2.id FROM public.email_outbox o2
    WHERE o2.status = 'a_envoyer' AND o2.expires_at <= now() + p_min_margin
    FOR UPDATE SKIP LOCKED);

  RETURN QUERY
  UPDATE public.email_outbox o
  SET status = 'en_cours', lease_token = gen_random_uuid(), claimed_at = now(), attempts = o.attempts + 1
  WHERE o.id = (
    SELECT o2.id FROM public.email_outbox o2
    WHERE o2.status = 'a_envoyer' AND o2.not_before <= now()
      AND o2.expires_at > now() + p_min_margin AND o2.attempts < p_max_attempts
    ORDER BY o2.not_before
    FOR UPDATE SKIP LOCKED
    LIMIT 1)
  RETURNING o.id, o.kind, o.recipient, o.params, o.secret_box, o.secret_key_id,
            o.attempts, o.expires_at, o.lease_token, o.correlation_id;
END
$$;

-- ── Clôtures (toron_mail) ───────────────────────────────────────────────
-- Toutes exigent le bail en cours : un service dont le bail a expiré, et
-- dont la ligne a été reprise par un autre, n'écrit plus rien.
CREATE FUNCTION mark_email_sent(p_id uuid, p_lease uuid, p_provider_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.email_outbox o
  SET status = 'envoye', sent_at = now(), secret_box = NULL, lease_token = NULL,
      provider_message_id = p_provider_id, last_error_code = NULL
  WHERE o.id = p_id AND o.status = 'en_cours' AND o.lease_token = p_lease;
  RETURN FOUND;
END
$$;

-- Sans date de reprise : échec définitif. Reprise à l'expiration ou
-- au-delà : expiré, avec DELAI_DEPASSE comme toute expiration (la cause
-- fournisseur est dans le journal du service). Sinon la ligne revient dans
-- la file à la date donnée. Renvoie le nouveau statut, ou NULL si le bail
-- n'est plus le bon.
CREATE FUNCTION mark_email_failed(p_id uuid, p_lease uuid, p_code text, p_retry_at timestamptz)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  new_status text;
BEGIN
  UPDATE public.email_outbox o
  SET status = CASE WHEN p_retry_at IS NULL THEN 'echec'
                    WHEN p_retry_at >= o.expires_at THEN 'expire'
                    ELSE 'a_envoyer' END,
      secret_box = CASE WHEN p_retry_at IS NULL OR p_retry_at >= o.expires_at THEN NULL ELSE o.secret_box END,
      not_before = CASE WHEN p_retry_at IS NULL OR p_retry_at >= o.expires_at THEN o.not_before ELSE p_retry_at END,
      lease_token = NULL,
      last_error_code = CASE WHEN p_retry_at >= o.expires_at THEN 'DELAI_DEPASSE' ELSE p_code END
  WHERE o.id = p_id AND o.status = 'en_cours' AND o.lease_token = p_lease
  RETURNING o.status INTO new_status;
  RETURN new_status;
END
$$;

-- Rend la ligne sans consommer de tentative : erreur de configuration,
-- disjoncteur ouvert ou arrêt du service avant l'envoi.
CREATE FUNCTION release_email(p_id uuid, p_lease uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.email_outbox o
  SET status = 'a_envoyer', lease_token = NULL, attempts = greatest(o.attempts - 1, 0)
  WHERE o.id = p_id AND o.status = 'en_cours' AND o.lease_token = p_lease;
  RETURN FOUND;
END
$$;

-- ── Entretien et supervision (toron_mail) ───────────────────────────────
-- Rétention plancher de 7 jours : les quotas sur 24 heures comptent les
-- lignes finales, une purge trop courte les rouvrirait.
CREATE FUNCTION purge_email_outbox(p_retention interval)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  purged integer;
BEGIN
  DELETE FROM public.email_outbox o
  WHERE o.status IN ('envoye', 'echec', 'expire')
    AND o.created_at < now() - greatest(coalesce(p_retention, interval '7 days'), interval '7 days');
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END
$$;

-- Agrégats sans donnée personnelle : lignes des dernières 24 heures et
-- toute ligne encore en attente, quel que soit son âge. n_last_hour compte
-- celles passées à leur statut dans l'heure : les expirations décidées à la
-- réclamation n'apparaissent nulle part ailleurs.
CREATE FUNCTION email_outbox_health()
RETURNS TABLE (kind text, status text, last_error_code text, n integer, n_last_hour integer,
               oldest_pending_seconds integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT o.kind, o.status, o.last_error_code, count(*)::integer,
         (count(*) FILTER (WHERE o.updated_at > now() - interval '1 hour'))::integer,
         CASE WHEN o.status IN ('a_envoyer', 'en_cours')
              THEN floor(extract(epoch FROM now() - min(o.created_at)))::integer END
  FROM public.email_outbox o
  WHERE o.created_at > now() - interval '24 hours' OR o.status IN ('a_envoyer', 'en_cours')
  GROUP BY o.kind, o.status, o.last_error_code
  ORDER BY o.kind, o.status, o.last_error_code
$$;

REVOKE ALL ON FUNCTION enqueue_account_email(uuid, text, uuid, text, jsonb, bytea, text, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_next_email(interval, interval, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_email_sent(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_email_failed(uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_email(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_email_outbox(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION email_outbox_health() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION enqueue_account_email(uuid, text, uuid, text, jsonb, bytea, text, timestamptz, uuid) TO toron_auth;
GRANT EXECUTE ON FUNCTION claim_next_email(interval, interval, integer) TO toron_mail;
GRANT EXECUTE ON FUNCTION mark_email_sent(uuid, uuid, text) TO toron_mail;
GRANT EXECUTE ON FUNCTION mark_email_failed(uuid, uuid, text, timestamptz) TO toron_mail;
GRANT EXECUTE ON FUNCTION release_email(uuid, uuid) TO toron_mail;
GRANT EXECUTE ON FUNCTION purge_email_outbox(interval) TO toron_mail;
GRANT EXECUTE ON FUNCTION email_outbox_health() TO toron_mail;

-- Retour arrière manuel :
-- DROP FUNCTION email_outbox_health(); DROP FUNCTION purge_email_outbox(interval);
-- DROP FUNCTION release_email(uuid, uuid); DROP FUNCTION mark_email_failed(uuid, uuid, text, timestamptz);
-- DROP FUNCTION mark_email_sent(uuid, uuid, text); DROP FUNCTION claim_next_email(interval, interval, integer);
-- DROP FUNCTION enqueue_account_email(uuid, text, uuid, text, jsonb, bytea, text, timestamptz, uuid);
-- DROP TABLE email_outbox;
-- DROP INDEX verifications_value_idx;
-- DROP ROLE IF EXISTS toron_mail_login; -- login de provisionnement (infra/initdb), s'il existe
-- REVOKE USAGE ON SCHEMA public FROM toron_mail;
-- DROP ROLE toron_mail;
