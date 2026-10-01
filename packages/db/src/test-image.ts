/**
 * Image PostgreSQL des tests d'intégration (testcontainers) : même version
 * que infra/compose.yaml et infra/staging/compose.yaml, pour que les tests
 * d'isolation RLS s'exécutent sur le moteur réellement déployé.
 * Dependabot ne suit pas ce fichier : l'aligner à chaque montée de version.
 */
export const PG_IMAGE = 'postgres:18.6-alpine3.23';
