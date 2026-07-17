import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Image autonome pour le déploiement conteneurisé (ADR-9)
  output: 'standalone',
  // Les paquets internes sont consommés en source TypeScript
  transpilePackages: ['@toron/core', '@toron/db', '@toron/ui', '@toron/frameworks'],
  poweredByHeader: false,
  webpack: (config) => {
    // Spécificateurs ESM « ./module.js » résolus vers les sources .ts —
    // requis car les paquets internes s'exécutent aussi sous Node natif.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
