// Rendu d'un e-mail à partir de son type et de paramètres déjà validés
// (parseEmailParams). Aucun texte libre : seuls les gabarits fixes ci-dessous.

import { publicOrigin } from '@toron/core';

import type { EmailKind, EmailParams } from './kinds.ts';
import { essai } from './templates/essai.ts';
import type { RenderedEmail } from './templates/layout.ts';
import { motDePasseModifie } from './templates/mot-de-passe-modifie.ts';
import { motDePasseReinitialisation } from './templates/mot-de-passe-reinitialisation.ts';

export type { RenderedEmail } from './templates/layout.ts';

export interface TemplateInput<K extends EmailKind> {
  params: EmailParams<K>;
  /** Lien construit par emailLink depuis l'origine publique. */
  link: string;
  now: Date;
}

const TEMPLATES: { [K in EmailKind]: (input: TemplateInput<K>) => RenderedEmail } = {
  mot_de_passe_reinitialisation: motDePasseReinitialisation,
  mot_de_passe_modifie: motDePasseModifie,
  essai,
};

/** Plafond de taille du HTML : au-delà, certains clients tronquent le message. */
export const MAX_HTML_BYTES = 100 * 1024;

/**
 * Rend l'e-mail. Lève une erreur si le lien ne part pas de l'origine
 * publique : aucun e-mail ne pointe ailleurs que vers l'application.
 */
export function render<K extends EmailKind>(kind: K, input: TemplateInput<K> & { origin: string }): RenderedEmail {
  if (!input.link.startsWith(`${publicOrigin(input.origin)}/`) || /[\s"'<>\\]/.test(input.link)) {
    throw new Error(`Type ${kind} : lien hors de l'origine publique.`);
  }
  const email = TEMPLATES[kind]({ params: input.params, link: input.link, now: input.now });
  if (Buffer.byteLength(email.html, 'utf8') > MAX_HTML_BYTES) throw new Error(`Type ${kind} : e-mail trop volumineux.`);
  return email;
}
