// Mise en page commune. Aucune couleur, image ni police distante : le client
// de messagerie applique son propre thème, clair ou sombre, et l'e-mail ne
// charge rien. Tables en role="presentation" pour les clients sans CSS.

import { escapeHtml, headerText } from '../text.ts';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Bloc de contenu, rendu à l'identique en texte et en HTML. */
export type Block =
  | { type: 'paragraphe'; text: string }
  /**
   * Le seul lien de l'e-mail : un libellé explicite en HTML, l'URL seule en
   * texte. `clair` introduit l'URL répétée en clair sous le lien HTML, pour
   * qui ne peut pas cliquer.
   */
  | { type: 'lien'; label: string; url: string; clair: string };

/** Pied commun : rappel contre l'hameçonnage et réponses non lues. */
const FOOTER = [
  'Toron ne vous demande jamais votre mot de passe ni un code de double authentification, par e-mail comme par téléphone.',
  'Message automatique de Toron — les réponses ne sont pas lues.',
] as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function htmlBlock(block: Block): string {
  if (block.type === 'paragraphe') return `<p style="margin:0 0 16px;">${escapeHtml(block.text)}</p>`;
  const url = escapeHtml(block.url);
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;"><tr>'
    + `<td style="border:2px solid;border-radius:6px;"><a href="${url}" style="display:inline-block;padding:12px 20px;font-weight:bold;text-decoration:underline;">${escapeHtml(block.label)}</a></td>`
    + '</tr></table>\n'
    + `<p style="margin:0 0 16px;">${escapeHtml(block.clair)}<br><span style="word-break:break-all;">${url}</span></p>`;
}

function textBlock(block: Block): string {
  return block.type === 'paragraphe' ? block.text : block.url;
}

export function layout(input: { subject: string; blocks: readonly Block[] }): RenderedEmail {
  if (input.blocks.filter((b) => b.type === 'lien').length !== 1) throw new Error('Un e-mail porte exactement un lien.');
  const subject = headerText(input.subject);
  const text = [...input.blocks.map(textBlock), ...FOOTER].join('\n\n');
  const body = input.blocks.map(htmlBlock).join('\n');
  const footer = FOOTER.map((line) => `<p style="margin:0 0 8px;font-size:14px;">${escapeHtml(line)}</p>`).join('\n');

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;">
<tr><td style="font-family:${FONT};font-size:16px;line-height:1.5;">
<p style="margin:0 0 24px;font-size:20px;font-weight:bold;">Toron</p>
${body}
<hr style="border:0;border-top:1px solid;margin:24px 0 16px;">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
  return { subject, text, html };
}
