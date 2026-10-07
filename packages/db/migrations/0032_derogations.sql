-- ═══════════════════════════════════════════════════════════════════════
-- 0032 · Dérogations aux règles de sécurité et de qualité
-- ═══════════════════════════════════════════════════════════════════════
-- Une dérogation autorise, pour une durée bornée, l'écart à une règle
-- (politique, contrôle, procédure) : justification métier, mesures
-- compensatoires, décision prise par une autre personne que le demandeur
-- et le responsable, échéance obligatoire de douze mois au plus.
-- Une dérogation décidée ne se réécrit pas : on la clôture ou on la
-- renouvelle, et le renouvellement est une nouvelle demande, décidée à
-- son tour. Aucune suppression : l'historique fait foi en audit.

ALTER TABLE controls ADD CONSTRAINT controls_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE assets ADD CONSTRAINT assets_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE policy_exceptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  title                 text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  rule                  text NOT NULL CHECK (length(btrim(rule)) BETWEEN 2 AND 300),
  justification         text NOT NULL CHECK (length(btrim(justification)) BETWEEN 10 AND 4000),
  compensating_measures text NOT NULL CHECK (length(btrim(compensating_measures)) BETWEEN 3 AND 4000),
  control_id            uuid,
  asset_id              uuid,
  requested_by          uuid NOT NULL REFERENCES users(id),
  owner_user_id         uuid NOT NULL REFERENCES users(id),
  starts_on             date NOT NULL,
  -- Dernier jour de validité (inclus).
  expires_on            date NOT NULL,
  status                text NOT NULL DEFAULT 'demandee'
                          CHECK (status IN ('demandee', 'approuvee', 'refusee', 'cloturee')),
  decided_by            uuid REFERENCES users(id),
  decided_at            timestamptz,
  decision_note         text CHECK (decision_note IS NULL OR length(decision_note) <= 2000),
  closed_by             uuid REFERENCES users(id),
  closed_at             timestamptz,
  closure_note          text CHECK (closure_note IS NULL OR length(closure_note) <= 2000),
  renewed_from_id       uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_exceptions_window
    CHECK (expires_on > starts_on AND expires_on <= (starts_on + interval '12 months')::date),
  -- Séparation des tâches : ni le demandeur ni le responsable ne statuent.
  CONSTRAINT policy_exceptions_segregation
    CHECK (decided_by IS NULL OR (decided_by <> requested_by AND decided_by <> owner_user_id)),
  CONSTRAINT policy_exceptions_decision CHECK (
    (status = 'demandee' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('approuvee', 'refusee') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    OR status = 'cloturee'),
  CONSTRAINT policy_exceptions_refusal_reason
    CHECK (status <> 'refusee' OR length(btrim(coalesce(decision_note, ''))) >= 5),
  CONSTRAINT policy_exceptions_closure
    CHECK ((status = 'cloturee') = (closed_by IS NOT NULL AND closed_at IS NOT NULL)),
  CONSTRAINT policy_exceptions_id_tenant_key UNIQUE (id, tenant_id),
  -- Contrôle, actif et dérogation d'origine : forcément de la même organisation.
  -- La suppression d'un contrôle ou d'un actif efface seulement le lien.
  FOREIGN KEY (control_id, tenant_id) REFERENCES controls (id, tenant_id) ON DELETE SET NULL (control_id),
  FOREIGN KEY (asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (asset_id),
  FOREIGN KEY (renewed_from_id, tenant_id) REFERENCES policy_exceptions (id, tenant_id)
);
CREATE INDEX policy_exceptions_tenant_idx ON policy_exceptions (tenant_id, status, expires_on);
CREATE INDEX policy_exceptions_control_idx ON policy_exceptions (control_id) WHERE control_id IS NOT NULL;
CREATE INDEX policy_exceptions_asset_idx ON policy_exceptions (asset_id) WHERE asset_id IS NOT NULL;
-- Un seul renouvellement en cours ou accordé par dérogation.
CREATE UNIQUE INDEX policy_exceptions_one_renewal
  ON policy_exceptions (renewed_from_id) WHERE renewed_from_id IS NOT NULL AND status IN ('demandee', 'approuvee');

CREATE TRIGGER policy_exceptions_set_updated_at
  BEFORE UPDATE ON policy_exceptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Cycle de vie : demandée → approuvée | refusée | clôturée ; approuvée →
-- clôturée. Après décision, le contenu est figé ; seuls la clôture et
-- l'effacement d'un lien (contrôle ou actif supprimé) restent possibles.
CREATE FUNCTION policy_exceptions_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'demandee' AND NEW.status IN ('approuvee', 'refusee', 'cloturee'))
    OR (OLD.status = 'approuvee' AND NEW.status = 'cloturee')) THEN
    RAISE EXCEPTION 'derogation_transition_interdite'
      USING HINT = 'Une dérogation refusée ou clôturée est définitive ; une dérogation approuvée se clôture ou se renouvelle.';
  END IF;
  IF OLD.status <> 'demandee' AND (
       (NEW.title, NEW.rule, NEW.justification, NEW.compensating_measures, NEW.owner_user_id,
        NEW.starts_on, NEW.expires_on, NEW.decided_by, NEW.decided_at, NEW.decision_note)
       IS DISTINCT FROM
       (OLD.title, OLD.rule, OLD.justification, OLD.compensating_measures, OLD.owner_user_id,
        OLD.starts_on, OLD.expires_on, OLD.decided_by, OLD.decided_at, OLD.decision_note)
    OR (NEW.control_id IS DISTINCT FROM OLD.control_id AND NEW.control_id IS NOT NULL)
    OR (NEW.asset_id IS DISTINCT FROM OLD.asset_id AND NEW.asset_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'derogation_decidee_immuable'
      USING HINT = 'Renouvelez la dérogation pour en modifier le contenu.';
  END IF;
  IF OLD.status = 'cloturee'
     AND (NEW.closed_by, NEW.closed_at, NEW.closure_note) IS DISTINCT FROM (OLD.closed_by, OLD.closed_at, OLD.closure_note) THEN
    RAISE EXCEPTION 'derogation_decidee_immuable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policy_exceptions_guard
  BEFORE UPDATE ON policy_exceptions FOR EACH ROW EXECUTE FUNCTION policy_exceptions_guard();

ALTER TABLE policy_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON policy_exceptions FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Pas de DELETE ; ni l'organisation, ni le demandeur, ni l'origine d'un
-- renouvellement ne changent après la création.
GRANT SELECT, INSERT ON policy_exceptions TO toron_app;
GRANT UPDATE (title, rule, justification, compensating_measures, control_id, asset_id, owner_user_id,
              starts_on, expires_on, status, decided_by, decided_at, decision_note,
              closed_by, closed_at, closure_note) ON policy_exceptions TO toron_app;

-- Le module se masque comme les autres modules optionnels.
ALTER TABLE tenants DROP CONSTRAINT tenants_disabled_modules_known;
ALTER TABLE tenants ADD CONSTRAINT tenants_disabled_modules_known CHECK (disabled_modules <@ ARRAY[
  'risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
  'revue_direction', 'processus', 'non_conformites', 'derogations'
]::text[]);

-- Notifications : une dérogation se confie à un responsable, et sa décision
-- est portée à la connaissance du demandeur et du responsable.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('assignation', 'decision'));
ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_subject_check
  CHECK (subject IN ('action', 'risque', 'obligation', 'fournisseur', 'traitement', 'derogation'));

-- Retour arrière manuel :
-- ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check,
--   ADD CONSTRAINT notifications_subject_check CHECK (subject IN ('action', 'risque', 'obligation', 'fournisseur', 'traitement'));
-- ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check,
--   ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('assignation'));
-- ALTER TABLE tenants DROP CONSTRAINT tenants_disabled_modules_known, ADD CONSTRAINT tenants_disabled_modules_known
--   CHECK (disabled_modules <@ ARRAY['risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
--          'revue_direction', 'processus', 'non_conformites']::text[]);
-- DROP TABLE policy_exceptions;
-- DROP FUNCTION policy_exceptions_guard();
-- ALTER TABLE assets DROP CONSTRAINT assets_id_tenant_key;
-- ALTER TABLE controls DROP CONSTRAINT controls_id_tenant_key;
