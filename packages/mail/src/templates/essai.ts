import type { TemplateInput } from '../render.ts';
import { parisDateTime } from '../text.ts';
import { layout, type RenderedEmail } from './layout.ts';

/** Envoyé par la CLI mail-essai pour vérifier un transport, jamais déposé en file. */
export function essai(input: TemplateInput<'essai'>): RenderedEmail {
  return layout({
    subject: 'Essai d’envoi Toron',
    blocks: [
      { type: 'paragraphe', text: 'Bonjour,' },
      {
        type: 'paragraphe',
        text: `Ce message d’essai a été émis le ${parisDateTime(input.now)} : il confirme que le service d’envoi de Toron atteint cette adresse. `
          + 'Aucune action n’est attendue.',
      },
      { type: 'paragraphe', text: 'Pour ouvrir Toron :' },
      { type: 'lien', label: 'Ouvrir Toron', url: input.link, clair: 'Si le bouton ne s’ouvre pas, copiez cette adresse dans votre navigateur :' },
    ],
  });
}
