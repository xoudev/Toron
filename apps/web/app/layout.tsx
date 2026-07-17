import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Toron',
  description:
    'Plateforme de conformité et de gestion des risques — ISO 27001, NIS 2, ISO 9001, RGPD sur un socle unique.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
