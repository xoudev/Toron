import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Vitrine en export statique, déployée sur Cloudflare Pages (ADR-9)
  output: 'export',
  poweredByHeader: false,
};

export default nextConfig;
