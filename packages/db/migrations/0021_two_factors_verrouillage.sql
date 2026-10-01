-- ═══════════════════════════════════════════════════════════════════════
-- 0021 · two_factors : colonnes exigées par Better Auth 1.7
-- ═══════════════════════════════════════════════════════════════════════
-- Better Auth 1.7 vérifie au démarrage que le schéma Drizzle contient tous
-- les champs de ses plugins ; le plugin twoFactor en ajoute trois :
--  · verified : facteur confirmé par un premier code. Défaut true, comme
--    Better Auth, pour que les facteurs déjà enrôlés restent valides.
--  · failed_verification_count / locked_until : verrouillage du compte après
--    échecs répétés de vérification 2FA (10 échecs, 15 min par défaut),
--    en plus du rate limiting de /api/auth (proxy.ts).
-- Ajouts non destructifs ; les droits de toron_auth sur la table (0002)
-- couvrent les nouvelles colonnes, toron_app n'y a toujours aucun accès.
-- Retour arrière : ALTER TABLE two_factors DROP COLUMN verified,
--   DROP COLUMN failed_verification_count, DROP COLUMN locked_until;

ALTER TABLE two_factors
  ADD COLUMN verified boolean NOT NULL DEFAULT true,
  ADD COLUMN failed_verification_count integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz;
