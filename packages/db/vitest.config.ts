import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les tests d'isolation démarrent un vrai Postgres (testcontainers) :
    // le premier lancement télécharge l'image.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Un seul conteneur partagé par fichier de test, exécution séquentielle.
    fileParallelism: false,
  },
});
