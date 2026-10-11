import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// La page est un composant client : le titre de l'étape (onglets, lecteurs
// d'écran) est porté par ce layout.
export const metadata: Metadata = { title: 'Mot de passe oublié — Toron' };

export default function MotDePasseOublieLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
