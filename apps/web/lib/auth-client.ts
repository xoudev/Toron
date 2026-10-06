'use client';

import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // La page de connexion conduit elle-même à l'étape du second facteur,
        // avec la destination déjà validée comme chemin interne.
      },
    }),
  ],
});
