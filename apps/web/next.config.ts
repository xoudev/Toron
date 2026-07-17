import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Image autonome pour le déploiement conteneurisé (ADR-9)
  output: 'standalone',
  // Les paquets internes sont consommés en source TypeScript
  transpilePackages: ['@toron/core', '@toron/db', '@toron/ui', '@toron/frameworks'],
  poweredByHeader: false,
};

export default nextConfig;
