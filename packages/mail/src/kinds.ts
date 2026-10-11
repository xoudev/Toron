// Registre des types d'e-mails. Le web ne dépose que des types de ce
// registre ; le service mail revalide les paramètres et le secret avant
// de construire le lien et de rendre le gabarit.

import { passwordResetLink, publicOrigin, RESET_TOKEN_PATTERN } from '@toron/core';
import { z } from 'zod';

interface EmailKindSpec {
  /** compte : hors organisation (tenant_id NULL) ; organisation : sous RLS. */
  scope: 'compte' | 'organisation';
  /** Faux pour un type qui ne passe jamais par la file (envoi direct de la CLI). */
  outbox: boolean;
  /** Forme attendue du secret descellé, ou null si le type n'en porte pas. */
  secret: RegExp | null;
  params: z.ZodType;
  link(origin: string, secret: string | null): string;
}

const noParams = z.strictObject({});

export const EMAIL_KINDS = {
  mot_de_passe_reinitialisation: {
    scope: 'compte',
    outbox: true,
    secret: RESET_TOKEN_PATTERN,
    params: noParams,
    link: (origin: string, secret: string | null) => passwordResetLink(origin, secret ?? ''),
  },
  mot_de_passe_modifie: {
    scope: 'compte',
    outbox: true,
    secret: null,
    params: z.strictObject({ modifieLe: z.iso.datetime({ offset: true }) }),
    link: (origin: string) => `${publicOrigin(origin)}/mot-de-passe/oublie`,
  },
  essai: {
    scope: 'compte',
    outbox: false,
    secret: null,
    params: noParams,
    link: (origin: string) => `${publicOrigin(origin)}/`,
  },
} as const satisfies Record<string, EmailKindSpec>;

export type EmailKind = keyof typeof EMAIL_KINDS;
export type EmailParams<K extends EmailKind> = z.output<(typeof EMAIL_KINDS)[K]['params']>;

/** Types acceptés par la contrainte CHECK de email_outbox (migration 0041). */
export const OUTBOX_EMAIL_KINDS = ['mot_de_passe_reinitialisation', 'mot_de_passe_modifie'] as const satisfies readonly EmailKind[];

export function isEmailKind(value: string): value is EmailKind {
  return Object.hasOwn(EMAIL_KINDS, value);
}

const PARAM_SCHEMAS: { [K in EmailKind]: z.ZodType<EmailParams<K>> } = {
  mot_de_passe_reinitialisation: EMAIL_KINDS.mot_de_passe_reinitialisation.params,
  mot_de_passe_modifie: EMAIL_KINDS.mot_de_passe_modifie.params,
  essai: EMAIL_KINDS.essai.params,
};

/** Paramètres relus depuis la base ou la ligne de commande, ou null s'ils ne sont pas conformes. */
export function parseEmailParams<K extends EmailKind>(kind: K, raw: unknown): EmailParams<K> | null {
  const schema: z.ZodType<EmailParams<K>> = PARAM_SCHEMAS[kind];
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Lien de l'e-mail, construit depuis l'origine publique configurée et le
 * secret descellé. Lève une erreur si le secret manque, est en trop ou n'a
 * pas la forme attendue pour ce type.
 */
export function emailLink(kind: EmailKind, origin: string, secret: string | null): string {
  const spec: EmailKindSpec = EMAIL_KINDS[kind];
  if (spec.secret === null) {
    if (secret !== null) throw new Error(`Type ${kind} : aucun secret attendu.`);
  } else if (secret === null || !spec.secret.test(secret)) {
    throw new Error(`Type ${kind} : secret absent ou mal formé.`);
  }
  return spec.link(origin, secret);
}
