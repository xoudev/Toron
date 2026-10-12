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

/** Secondes avant la fin de la fenêtre si la limite est dépassée, sinon null. */
function rateLimited(key: string, limit: number, windowMs: number, now: number): number | null {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  b.count += 1;
  return b.count > limit ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : null;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  return xff?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

// Mot de passe oublié : le jeton ne transite que dans le corps du POST.
// GET /api/auth/reset-password/<jeton> le validerait sans le consommer puis
// le recopierait dans une URL de redirection ; ?token= le mettrait dans les
// journaux d'accès. Better Auth refuse aussi les deux (lib/auth-options.ts).
const RESET_TOKEN_PATH = '/api/auth/reset-password/';
const RESET_PATH = '/api/auth/reset-password';
const RESET_REQUEST_PATH = '/api/auth/request-password-reset';
// 10 par 15 minutes et par IP : tolère le NAT d'une entreprise, borne la
// force brute du jeton et le bombardement d'une boîte. Toujours actives,
// quel que soit NODE_ENV (le limiteur de Better Auth ne l'est qu'en production).
const RESET_WINDOW_MS = 15 * 60_000;
const RESET_LIMIT = 10;

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const now = Date.now();

  if (pathname.startsWith(RESET_TOKEN_PATH)) {
    return new NextResponse('Page introuvable.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (pathname === RESET_PATH && req.nextUrl.searchParams.has('token')) {
    return new NextResponse('Requête refusée — le jeton se transmet dans le corps de la requête, jamais dans l’adresse.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Rate limiting ciblé : authentification et endpoints publics (§8.1).
  const ip = clientIp(req);
  const rule =
    pathname === RESET_REQUEST_PATH ? { bucket: 'reinit-demande', limit: RESET_LIMIT, windowMs: RESET_WINDOW_MS } :
    pathname === RESET_PATH ? { bucket: 'reinit', limit: RESET_LIMIT, windowMs: RESET_WINDOW_MS } :
    pathname.startsWith('/api/auth') ? { bucket: 'auth', limit: 20, windowMs: 60_000 } :
    pathname.startsWith('/verifier') ? { bucket: 'verify', limit: 60, windowMs: 60_000 } :
    pathname.startsWith('/fournisseur/') ? { bucket: 'portal', limit: 60, windowMs: 60_000 } :
    null;
  const retryAfter = rule ? rateLimited(`${rule.bucket}:${ip}`, rule.limit, rule.windowMs, now) : null;
  if (retryAfter !== null) {
    return new NextResponse(
      retryAfter > 60
        ? 'Trop de requêtes depuis votre connexion — patientez quelques minutes puis réessayez.'
        : 'Trop de requêtes — réessayez dans une minute.',
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter), 'Content-Type': 'text/plain; charset=utf-8' },
      },
    );
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
