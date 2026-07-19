import './landing.css';

import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Toron — Prouvez une fois. Couvrez tout.',
  description:
    'La plateforme de conformité et de gestion des risques des PME et ETI françaises — ISO 27001, NIS 2, ISO 9001, RGPD sur un socle unique, hébergée en Europe.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body style={{ fontFamily: 'var(--font-sans), var(--sans)' }}>{children}</body>
    </html>
  );
}
