import './landing.css';

import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

// IBM Plex (licence OFL 1.1) livrée par les paquets @fontsource, sous-ensemble
// latin : le build ne télécharge rien chez Google Fonts (résultat reproductible,
// aucun service tiers hors UE), les fichiers sont figés par le lockfile.
const plexSans = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-sans',
});
const plexMono = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono',
});

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
