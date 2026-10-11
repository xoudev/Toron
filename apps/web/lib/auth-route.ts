import 'server-only';

import { randomInt, randomUUID } from 'node:crypto';

import { PASSWORD_RESET_REQUEST_JITTER_MS, resetRequestPadding } from '@toron/core';

import { errorCode } from './email-outbox.ts';

// Handlers de /api/auth/*, séparés de la route pour être testés avec un
// gestionnaire simulé.

type AuthHandler = (request: Request) => Promise<Response>;

export const RESET_REQUEST_PATH = '/api/auth/request-password-reset';

const INTERNAL_ERROR_MESSAGE = 'Service momentanément indisponible — réessayez dans quelques instants.';

/**
 * Une erreur qui n'est pas une APIError atteint ce point (onAPIError.throw) :
 * seuls son code et un identifiant de corrélation sont journalisés, jamais
 * son message, qui peut citer une adresse ou une empreinte.
 */
async function guarded(handler: () => AuthHandler, request: Request): Promise<Response> {
  try {
    return await handler()(request);
  } catch (err) {
    const correlationId = randomUUID();
    console.error('[auth] erreur interne', { correlationId, code: errorCode(err) });
    return Response.json({ code: 'ERREUR_INTERNE', message: INTERNAL_ERROR_MESSAGE, correlationId }, { status: 500 });
  }
}

/** `handler` est résolu à chaque requête : l'instance reste paresseuse. */
export function createAuthRoute(handler: () => AuthHandler) {
  return {
    GET: (request: Request): Promise<Response> => guarded(handler, request),
    async POST(request: Request): Promise<Response> {
      if (new URL(request.url).pathname !== RESET_REQUEST_PATH) return guarded(handler, request);
      // Demande de lien : durée plancher avec gigue, pour que le temps de
      // réponse ne dise pas si l'adresse correspond à un compte.
      const started = performance.now();
      try {
        return await guarded(handler, request);
      } finally {
        const wait = resetRequestPadding(performance.now() - started, randomInt(0, PASSWORD_RESET_REQUEST_JITTER_MS + 1));
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
    },
  };
}
