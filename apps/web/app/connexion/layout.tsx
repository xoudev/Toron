import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// La page est un composant client : le titre de l'étape (onglets, lecteurs
// d'écran) est porté par ce layout.
export const metadata: Metadata = { title: 'Connexion — Toron' };

export default function ConnexionLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
