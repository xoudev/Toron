import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Titre propre à l'étape (onglets, lecteurs d'écran) : le lien d'invitation
// s'ouvre souvent à côté d'un onglet Toron déjà présent.
export const metadata: Metadata = { title: 'Invitation — Toron' };

export default function InvitationLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
