-- ═══════════════════════════════════════════════════════════════════════
-- 0026 · Modules activables par organisation
-- ═══════════════════════════════════════════════════════════════════════
-- Une organisation masque les modules qui ne la concernent pas (pack qualité
-- pour un SMSI pur, EBIOS RM pour un QMS…). On stocke les modules désactivés :
-- les organisations existantes gardent tout. Les données d'un module masqué
-- restent en base, sous les mêmes politiques RLS.

ALTER TABLE tenants ADD COLUMN disabled_modules text[] NOT NULL DEFAULT '{}'
  CONSTRAINT tenants_disabled_modules_known CHECK (disabled_modules <@ ARRAY[
    'risques', 'ebios', 'incidents', 'actifs', 'audits', 'fournisseurs',
    'revue_direction', 'processus', 'non_conformites'
  ]::text[]);

-- La politique tenant_self_update (0001) borne déjà la mise à jour à
-- l'organisation courante.

-- Retour arrière manuel :
-- ALTER TABLE tenants DROP COLUMN disabled_modules;
