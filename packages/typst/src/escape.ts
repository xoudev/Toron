// Échappement commun à tous les livrables : une valeur saisie par un
// utilisateur (titre, nom, libellé) est insérée comme TEXTE en mode balisage
// Typst, jamais interprétée. Rendu identique, quelle que soit la saisie.

/** Sauts de ligne au sens Unicode (dont LS, PS, NEL, VT, FF) : ramenés à un espace. */
const NEWLINES = /[\r\n\v\f\u0085\u2028\u2029]+/g;

/**
 * Symboles du balisage Typst, échappés un à un par « \ » :
 * code (#), contenu ([ ]), gras (*), emphase (_), brut (`), maths ($),
 * étiquettes (< > @), espace insécable (~), commentaires et listes de
 * termes (/), listes, titres et raccourcis typographiques (- + =).
 */
const MARKUP = /[\\#[\]*_`$<>@~/\-+=]/g;

/** Texte utilisateur → texte Typst inerte. */
export function typstText(value: string): string {
  return value
    .replace(NEWLINES, ' ')
    .replace(MARKUP, (c) => `\\${c}`)
    // « 1. » en tête de bloc ouvrirait une liste numérotée.
    .replace(/^(\s*\d+)\./, '$1\\.');
}
