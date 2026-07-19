import type { NextConfig } from 'next';

// En-têtes durcis appliqués à toutes les routes (§8.1). La CSP à nonce est
// posée par le middleware (elle varie par requête) ; le reste est statique.
const HARDENED_HEADERS = [
  // HSTS : ignoré par les navigateurs en HTTP (local), actif dès HTTPS (prod).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Image autonome pour le déploiement conteneurisé (ADR-9)
  output: 'standalone',
  // Les paquets internes sont consommés en source TypeScript
  transpilePackages: ['@toron/core', '@toron/db', '@toron/ui', '@toron/frameworks'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: HARDENED_HEADERS }];
  },
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
