-- ═══════════════════════════════════════════════════════════════════════
-- 0039 · Contrôles types (module 5.2, cross-mapping)
-- ═══════════════════════════════════════════════════════════════════════
-- Une organisation peut partir des contrôles types Toron
-- (packages/frameworks) : chaque contrôle repris garde la clé de son modèle.
-- La clé rend la reprise idempotente (un modèle n'est repris qu'une fois par
-- organisation) et permet de compléter les rattachements quand un
-- référentiel est activé plus tard. Le contrôle reste celui de
-- l'organisation : elle l'adapte librement.

ALTER TABLE controls ADD COLUMN template_key text
  CHECK (template_key IS NULL OR template_key ~ '^[a-z]+\.[a-z_]+$');
ALTER TABLE controls ADD CONSTRAINT controls_tenant_template_key UNIQUE (tenant_id, template_key);

-- Un contrôle repris naît en brouillon, avec la fréquence de revue proposée
-- par son modèle. Sa première revue est due une période après son
-- activation, pas après sa création : un brouillon adapté puis activé des
-- mois plus tard ne doit pas apparaître aussitôt en retard.
ALTER TABLE controls ADD COLUMN activated_on date;

-- Retour arrière manuel :
-- ALTER TABLE controls DROP COLUMN activated_on;
-- ALTER TABLE controls DROP CONSTRAINT controls_tenant_template_key;
-- ALTER TABLE controls DROP COLUMN template_key;
