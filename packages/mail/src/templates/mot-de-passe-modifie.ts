import type { TemplateInput } from '../render.ts';
import { parisDateTime } from '../text.ts';
import { layout, type RenderedEmail } from './layout.ts';

export function motDePasseModifie(input: TemplateInput<'mot_de_passe_modifie'>): RenderedEmail {
  return layout({
    subject: 'Votre mot de passe Toron a été modifié',
    blocks: [
      { type: 'paragraphe', text: 'Bonjour,' },
      {
        type: 'paragraphe',
        text: `Le mot de passe de votre compte a été modifié le ${parisDateTime(new Date(input.params.modifieLe))}. `
          + 'Toutes vos sessions ont été fermées ; la double authentification reste demandée à la connexion si elle est activée.',
      },
      { type: 'paragraphe', text: 'Ce n’était pas vous ? Demandez immédiatement un nouveau lien sur cette page :' },
      {
        type: 'lien',
        label: 'Demander un nouveau lien',
        url: input.link,
        clair: 'Si le bouton ne s’ouvre pas, copiez cette adresse dans votre navigateur :',
      },
      { type: 'paragraphe', text: 'Puis prévenez le propriétaire ou le RSSI de votre organisation.' },
    ],
  });
}
