import { createHash } from 'node:crypto';

// ── En-têtes de sécurité de la vitrine (Cloudflare Pages, ADR-9 · §8.1) ──
// L'export statique Next.js embarque des scripts inline (amorçage RSC) dont
// le contenu change à chaque build. Sans serveur, pas de nonce par requête :
// la CSP autorise donc chaque script inline par son empreinte SHA-256,
// calculée après le build. Jamais de 'unsafe-inline' pour les scripts.

/** Limite Cloudflare Pages : 2 000 caractères par ligne du fichier `_headers`. */
export const MAX_HEADER_LINE_LENGTH = 2000;

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
// `(?:^|\s)` évite de confondre `data-src=` avec un vrai `src=`.
const SRC_ATTRIBUTE = /(?:^|\s)src\s*=/i;

/** Empreintes CSP (`'sha256-...'`) des scripts inline d'un document HTML. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const [, attributes = '', body = ''] of html.matchAll(SCRIPT_TAG)) {
    if (SRC_ATTRIBUTE.test(attributes)) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/** CSP de la vitrine : tout est interdit par défaut, puis ouvert au strict nécessaire. */
export function contentSecurityPolicy(scriptHashes: readonly string[]): string {
  const hashes = [...new Set(scriptHashes)].sort();
  return [
    `default-src 'none'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'none'`,
    ['script-src', `'self'`, ...hashes].join(' '),
    // Attributs style= générés par React : 'unsafe-inline' limité aux STYLES.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self'`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `manifest-src 'self'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

type HeaderRule = readonly [pattern: string, headers: ReadonlyArray<readonly [name: string, value: string]>];

/**
 * Contenu du fichier `_headers` de Cloudflare Pages.
 * Lève une erreur explicite si une ligne dépasse la limite de la plateforme
 * (elle serait sinon ignorée en silence au déploiement).
 */
export function headersFile(scriptHashes: readonly string[]): string {
  const rules: readonly HeaderRule[] = [
    [
      '/*',
      [
        ['Content-Security-Policy', contentSecurityPolicy(scriptHashes)],
        // Sans `preload` : l'inscription HSTS preload se décide au niveau du
        // domaine enregistrable, pas d'un sous-domaine.
        ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
        ['X-Content-Type-Options', 'nosniff'],
        ['Referrer-Policy', 'strict-origin-when-cross-origin'],
        ['X-Frame-Options', 'DENY'],
        ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()'],
        ['Cross-Origin-Opener-Policy', 'same-origin'],
        ['X-Permitted-Cross-Domain-Policies', 'none'],
      ],
    ],
    // Fichiers fingerprintés par Next : cache long sans revalidation.
    ['/_next/static/*', [['Cache-Control', 'public, max-age=31536000, immutable']]],
    // Les URL techniques *.pages.dev ne doivent pas concurrencer le domaine public.
    ['https://:project.pages.dev/*', [['X-Robots-Tag', 'noindex']]],
    ['https://:version.:project.pages.dev/*', [['X-Robots-Tag', 'noindex']]],
  ];

  const lines = ['# Généré par apps/site/scripts/security-headers-cli.ts après `next build`, ne pas éditer.'];
  for (const [pattern, headers] of rules) {
    lines.push(pattern, ...headers.map(([name, value]) => `  ${name}: ${value}`));
  }

  const tooLong = lines.find((line) => line.length > MAX_HEADER_LINE_LENGTH);
  if (tooLong !== undefined) {
    throw new Error(
      `Ligne de _headers trop longue (${tooLong.length} > ${MAX_HEADER_LINE_LENGTH} caractères) : ` +
        'trop de scripts inline distincts pour une CSP unique. Scindez la CSP par chemin de page.',
    );
  }
  return `${lines.join('\n')}\n`;
}
