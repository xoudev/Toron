-- ═══════════════════════════════════════════════════════════════════════
-- 0025 · Renouvellement des preuves (module 5.7)
-- ═══════════════════════════════════════════════════════════════════════
-- Renouveler une preuve crée une nouvelle preuve (nouveau fichier, nouvelle
-- empreinte, nouvelle validité) qui hérite des rattachements de l'ancienne ;
-- l'ancienne reste consultable comme historique et pointe vers celle qui la
-- remplace. Une preuve remplacée ne compte plus dans les échéances.

ALTER TABLE evidences
  ADD COLUMN superseded_by uuid REFERENCES evidences(id) ON DELETE SET NULL,
  ADD COLUMN superseded_at timestamptz,
  ADD CONSTRAINT evidences_superseded_coherent
    CHECK ((superseded_by IS NULL) = (superseded_at IS NULL)),
  ADD CONSTRAINT evidences_not_self_superseded
    CHECK (superseded_by IS NULL OR superseded_by <> id);

CREATE INDEX evidences_current_idx ON evidences (tenant_id, valid_until) WHERE superseded_by IS NULL;

-- Les politiques RLS existantes couvrent les nouvelles colonnes.

-- Retour arrière manuel :
-- DROP INDEX evidences_current_idx;
-- ALTER TABLE evidences DROP CONSTRAINT evidences_not_self_superseded,
--   DROP CONSTRAINT evidences_superseded_coherent,
--   DROP COLUMN superseded_at, DROP COLUMN superseded_by;
