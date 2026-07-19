// Assainisseur HTML côté client (allowlist), utilisé avant l'enregistrement et
// avant tout rendu du contenu documentaire. S'appuie sur le parseur DOM d'un
// <template> (inerte : les <img onerror> ne s'exécutent pas au parsing) pour
// une désinfection fiable. Le durcissement serveur (hardenDocumentHtml) est la
// défense en profondeur.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'font', 'a', 'blockquote', 'hr',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);
const ATTRS_BY_TAG: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  font: new Set(['color']),
};
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'background-color', 'text-align', 'font-weight', 'font-style',
  'text-decoration', 'font-size',
]);

function filterStyle(style: string): string {
  return style
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .filter((decl) => {
      const prop = decl.split(':')[0]?.trim().toLowerCase() ?? '';
      const value = decl.slice(decl.indexOf(':') + 1).toLowerCase();
      if (!ALLOWED_STYLE_PROPS.has(prop)) return false;
      // Pas d'url()/expression()/javascript dans les valeurs de style.
      if (/url\s*\(|expression|javascript:/.test(value)) return false;
      return true;
    })
    .join('; ');
}

function cleanNode(node: Node): void {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === Node.COMMENT_NODE) {
      node.removeChild(child);
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    cleanNode(el); // désinfecte le sous-arbre d'abord
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Balise interdite : on remonte ses enfants (déjà propres) et on la retire.
      while (el.firstChild) node.insertBefore(el.firstChild, el);
      node.removeChild(el);
      return;
    }
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name === 'style') {
        const filtered = filterStyle(attr.value);
        if (filtered) el.setAttribute('style', filtered);
        else el.removeAttribute('style');
        return;
      }
      if (name === 'href') {
        const v = attr.value.trim();
        if (!/^(https?:|mailto:|#|\/)/i.test(v)) el.removeAttribute('href');
        else el.setAttribute('rel', 'noreferrer');
        return;
      }
      if (!(ATTRS_BY_TAG[tag]?.has(name))) el.removeAttribute(attr.name);
    });
  });
}

/** Désinfecte un fragment HTML (allowlist de balises/attributs/styles). */
export function sanitizeDocumentHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  cleanNode(tpl.content);
  return tpl.innerHTML;
}
