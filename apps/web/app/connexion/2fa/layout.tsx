import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// La page est un composant client : le titre de l'étape (onglets, lecteurs
// d'écran) est porté par ce layout.
export const metadata: Metadata = { title: 'Double authentification — Toron' };

export default function Verification2faLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
