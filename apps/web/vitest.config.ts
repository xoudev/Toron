import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)),
      '@/': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', '*.test.ts'],
    // Les tests d'intégration démarrent un vrai Postgres (testcontainers) :
    // le premier lancement télécharge l'image.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
