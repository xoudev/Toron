-- ═══════════════════════════════════════════════════════════════════════
-- 0007 · Plan d'action unifié (module 5.5, phase MVP) — P2
-- ═══════════════════════════════════════════════════════════════════════
-- Un seul moteur d'actions pour TOUTES les origines (risque, écart, constat,
-- non-conformité, incident, revue, manuel). Une action pré-lie son origine et
-- les exigences concernées. Le statut « en retard » n'est JAMAIS stocké : il
-- se CALCULE à partir de l'échéance (RM §5.5) — l'enum ne le contient pas.
-- Relances J-7 / escalade = jobs (pg-boss + TEM), reportées (backlog).

CREATE TYPE action_origin AS ENUM (
  'risk', 'finding', 'incident', 'nc', 'assessment', 'review', 'manual'
);
CREATE TYPE action_priority AS ENUM ('p1', 'p2', 'p3');
-- Statuts STOCKABLES uniquement ; « en_retard » est dérivé côté cœur métier.
CREATE TYPE action_status AS ENUM ('planifie', 'en_cours', 'termine', 'verification');
CREATE TYPE action_link_target AS ENUM ('requirement', 'control');

CREATE TABLE actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  title         text NOT NULL,
  description   text,
  origin_type   action_origin NOT NULL DEFAULT 'manual',
  origin_id     uuid,                    -- l'objet source (risque, campagne…)
  owner_user_id uuid REFERENCES users(id),
  due_date      date,
  priority      action_priority NOT NULL DEFAULT 'p2',
  effort        integer,                 -- charge estimée (jours-homme), optionnel
  status        action_status NOT NULL DEFAULT 'planifie',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX actions_tenant_idx ON actions (tenant_id, status, due_date);
CREATE INDEX actions_origin_idx ON actions (origin_type, origin_id);

-- Liaisons n-n vers exigences / contrôles (traçabilité de l'origine, P2).
CREATE TABLE action_links (
  action_id   uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  target_type action_link_target NOT NULL,
  target_id   uuid NOT NULL,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action_id, target_type, target_id)
);

CREATE TABLE action_subtasks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  action_id  uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  title      text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_subtasks_action_idx ON action_subtasks (action_id, sort_order);

-- Fil de commentaires (append-only : trace de la vie de l'action).
CREATE TABLE action_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  action_id      uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id),
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX action_comments_action_idx ON action_comments (action_id, created_at);

CREATE TRIGGER actions_set_updated_at
  BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER action_subtasks_set_updated_at
  BEFORE UPDATE ON action_subtasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS : isolation stricte par tenant ──────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['actions', 'action_links', 'action_subtasks', 'action_comments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO toron_app
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
      t
    );
  END LOOP;
END
$$;

-- ── Droits applicatifs ──────────────────────────────────────────────────
-- action_comments : append-only (fil de discussion). Le reste : CRUD tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON actions TO toron_app;
GRANT SELECT, INSERT, DELETE ON action_links TO toron_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON action_subtasks TO toron_app;
GRANT SELECT, INSERT ON action_comments TO toron_app;
