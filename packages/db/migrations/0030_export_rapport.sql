-- ═══════════════════════════════════════════════════════════════════════
-- 0030 · Rapport de direction scellé (module 5.11, V1)
-- ═══════════════════════════════════════════════════════════════════════
-- Ajoute le type d'export 'rapport' : le rapport de direction réutilise le
-- pipeline de scellement existant (poinçon SHA-256 + page publique
-- /verifier). L'objet de référence est l'organisation elle-même.

ALTER TYPE export_type ADD VALUE IF NOT EXISTS 'rapport';

-- Retour arrière : PostgreSQL ne retire pas une valeur d'énumération ; elle
-- reste sans effet sans l'écran et le worker associés.
