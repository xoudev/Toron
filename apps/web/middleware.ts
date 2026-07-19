import { NextResponse, type NextRequest } from 'next/server';

// ── §8.1 · Durcissement web : CSP stricte à nonce + rate limiting ──────
// La CSP varie par requête (nonce) ; elle est donc posée ici et non dans
// next.config (en-têtes statiques). Next applique automatiquement le nonce à
// ses propres scripts en lisant l'en-tête CSP de la REQUÊTE ; le script inline
// d'init du thème (layout) porte le même nonce via l'en-tête x-nonce.

const isDev = process.env.NODE_ENV === 'development';

function buildCsp(nonce: string): string {
  // 'strict-dynamic' : les scripts chargés par un script noncé héritent de la
  // confiance — pas de liste d'hôtes à maintenir. 'unsafe-inline' n'est gardé
  // que pour les STYLES (attributs style=), pas pour les scripts.
  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

// ── Rate limiting en mémoire (fenêtre fixe) ─────────────────────────────
// Par instance : suffisant en MVP / mono-nœud. Un limiteur distribué (Redis)
// est reporté au backlog pour le déploiement multi-instances.
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

function rateLimited(key: string, limit: number, windowMs: number, now: number): boolean {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  return xff?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const now = Date.now();

  // Rate limiting ciblé : authentification et endpoints publics (§8.1).
  const ip = clientIp(req);
  const rule =
    pathname.startsWith('/api/auth') ? { bucket: 'auth', limit: 20, windowMs: 60_000 } :
    pathname.startsWith('/verifier') ? { bucket: 'verify', limit: 60, windowMs: 60_000 } :
    null;
  if (rule && rateLimited(`${rule.bucket}:${ip}`, rule.limit, rule.windowMs, now)) {
    return new NextResponse('Trop de requêtes — réessayez dans une minute.', {
      status: 429,
      headers: { 'Retry-After': '60', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Nonce par requête (16 octets aléatoires en base64).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Exclut les assets statiques (pas de CSP/rate limit à poser dessus).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|css|js)$).*)',
  ],
};
