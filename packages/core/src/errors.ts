/**
 * Format d'erreur standard de la plateforme (S4) :
 * jamais de stack trace au client, toujours { code, message, correlationId }.
 * Le message est destiné à l'utilisateur : en français, cause + correction.
 */
export interface AppError {
  code: string;
  message: string;
  correlationId: string;
}

export function appError(
  code: string,
  message: string,
  correlationId: string = crypto.randomUUID(),
): AppError {
  return { code, message, correlationId };
}
