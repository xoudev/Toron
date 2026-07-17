import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/out/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'docs/**',
      'infra/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // ADR-3 / PLAN.md §13 : toute requête DB passe par withTenant() de
    // @toron/db — l'accès direct au driver ou au client Drizzle est
    // interdit hors du paquet db.
    files: ['**/*.{ts,tsx}'],
    ignores: ['packages/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'postgres',
              message:
                'Accès base interdit hors @toron/db : utilisez withTenant() (ADR-3).',
            },
          ],
          patterns: [
            {
              group: ['drizzle-orm/postgres-js*'],
              message:
                'Accès base interdit hors @toron/db : utilisez withTenant() (ADR-3).',
            },
          ],
        },
      ],
    },
  },
);
