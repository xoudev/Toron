'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

/**
 * Déconnexion : la session est invalidée côté serveur avant de quitter la
 * page. `redirectTo` doit être un chemin interne (ex. retour sur un lien
 * d'invitation après changement de compte).
 */
export function SignOutButton({
  className = 'sidebar-link',
  label = 'Se déconnecter',
  redirectTo = '/connexion',
}: {
  className?: string;
  label?: string;
  redirectTo?: string;
}) {
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    await authClient.signOut();
    window.location.href = redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/connexion';
  }
  return (
    <button type="button" className={className} onClick={signOut} disabled={pending}>
      {pending ? 'Déconnexion…' : label}
    </button>
  );
}
