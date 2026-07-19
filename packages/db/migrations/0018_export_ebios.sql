-- ═══════════════════════════════════════════════════════════════════════
-- 0018 · Livrable EBIOS RM scellé (module 5.4b, finitions)
-- ═══════════════════════════════════════════════════════════════════════
-- Ajoute le type d'export 'ebios' : le livrable EBIOS RM (étude + scénarios
-- opérationnels + kill chains) réutilise le pipeline de scellement existant
-- (poinçon SHA-256 + page publique /verifier).

ALTER TYPE export_type ADD VALUE IF NOT EXISTS 'ebios';
