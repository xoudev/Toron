import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Titre propre à l'étape (onglets, lecteurs d'écran) : le lien d'invitation
// s'ouvre souvent à côté d'un onglet Toron déjà présent.
// Le jeton est dans l'URL : la page n'est ni indexée ni transmise en référent.
export const metadata: Metadata = {
  title: 'Invitation — Toron',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function InvitationLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
