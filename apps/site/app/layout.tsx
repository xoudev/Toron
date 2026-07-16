import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Toron — Prouvez une fois. Couvrez tout.',
  description:
    'La plateforme de conformité des PME et ETI françaises — ISO 27001, NIS 2, ISO 9001, RGPD sur un socle unique.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
