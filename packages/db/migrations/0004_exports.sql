-- ═══════════════════════════════════════════════════════════════════════
-- 0004 · Exports scellés — le poinçon (ADR-6, module 5.3c)
-- ═══════════════════════════════════════════════════════════════════════
-- Chaque livrable généré (SoA d'abord) est enregistré ici : type, empreinte
-- SHA-256 du PDF, slug de vérification unique. La page publique /verifier
-- résout un slug via une fonction SECURITY DEFINER qui n'expose QUE des
-- champs non sensibles (type, date, empreinte) — jamais le tenant ni le PDF.
-- Stockage du PDF : bytea en local (MVP). En production, file_ref pointera
-- l'Object Storage Scaleway (URL signée courte) et pdf restera NULL.

CREATE TYPE export_status AS ENUM ('en_cours', 'scelle', 'echec');
CREATE TYPE export_type AS ENUM ('soa');

CREATE TABLE exports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  type        export_type NOT NULL,
  object_ref  uuid,                    -- l'objet source (ex. assessment_id)
  status      export_status NOT NULL DEFAULT 'en_cours',
  file_ref    text,                    -- clé Object Storage (prod)
  pdf         bytea,                   -- PDF scellé (stockage local MVP)
  sha256      text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  verify_slug text,
  error       text,                    -- cause si status = echec (sans PII)
  requested_by uuid REFERENCES users(id),
  sealed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Un export scellé porte forcément empreinte + slug ; un slug est unique.
  CONSTRAINT exports_scelle_complet CHECK (
    status <> 'scelle' OR (sha256 IS NOT NULL AND verify_slug IS NOT NULL AND sealed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX exports_verify_slug_unique ON exports (verify_slug) WHERE verify_slug IS NOT NULL;
CREATE INDEX exports_tenant_idx ON exports (tenant_id, created_at DESC);

CREATE TRIGGER exports_set_updated_at
  BEFORE UPDATE ON exports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS : lecture/écriture tenant-scopées pour le rôle applicatif ────────
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exports FOR ALL TO toron_app
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON exports TO toron_app;

-- ── Vérification publique du poinçon (ADR-6) ────────────────────────────
-- SECURITY DEFINER : contourne la RLS pour résoudre un slug SANS contexte
-- tenant, mais n'expose que des champs non sensibles d'un export SCELLÉ.
-- Jamais le PDF, le tenant, ni l'objet source.
CREATE FUNCTION verify_export(slug text)
RETURNS TABLE (type export_type, sha256 text, sealed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.type, e.sha256, e.sealed_at
  FROM exports e
  WHERE e.verify_slug = slug AND e.status = 'scelle'
$$;

-- Exposée au rôle applicatif (page /verifier via la connexion applicative).
REVOKE ALL ON FUNCTION verify_export(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_export(text) TO toron_app, toron_auth;
