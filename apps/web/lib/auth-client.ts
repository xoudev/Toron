'use client';

import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // La destination demandée avant connexion suit l'étape du second facteur ;
        // elle est revalidée comme chemin interne sur la page de vérification.
        const suite = new URLSearchParams(window.location.search).get('suite');
        window.location.href = suite ? `/connexion/2fa?suite=${encodeURIComponent(suite)}` : '/connexion/2fa';
      },
    }),
  ],
});
