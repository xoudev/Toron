import type { TemplateInput } from '../render.ts';
import { layout, type RenderedEmail } from './layout.ts';

export function motDePasseReinitialisation(input: TemplateInput<'mot_de_passe_reinitialisation'>): RenderedEmail {
  return layout({
    subject: 'Réinitialisation de votre mot de passe Toron',
    blocks: [
      { type: 'paragraphe', text: 'Bonjour,' },
      {
        type: 'paragraphe',
        text: 'Une demande de réinitialisation du mot de passe a été faite pour le compte Toron associé à cette adresse.',
      },
      { type: 'paragraphe', text: 'Pour choisir un nouveau mot de passe, ouvrez ce lien dans les 30 minutes :' },
      {
        type: 'lien',
        label: 'Choisir un nouveau mot de passe',
        url: input.link,
        clair: 'Si le bouton ne s’ouvre pas, copiez cette adresse dans votre navigateur :',
      },
      {
        type: 'paragraphe',
        text: 'Ce lien ne sert qu’une fois ; si vous avez reçu plusieurs e-mails, seul le plus récent fonctionne. '
          + 'Après le changement, toutes vos sessions seront fermées ; la double authentification restera demandée si elle est activée.',
      },
      {
        type: 'paragraphe',
        text: 'Vous n’êtes pas à l’origine de cette demande ? Ignorez ce message : votre mot de passe actuel reste valable. '
          + 'Si ces e-mails se répètent, prévenez le responsable sécurité de votre organisation.',
      },
    ],
  });
}
