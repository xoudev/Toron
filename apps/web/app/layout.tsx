import '@toron/ui/tokens.css';
import '@toron/ui/shell.css';
import '@toron/ui/data-screen.css';
import '@toron/ui/referentiels.css';
import '@toron/ui/risques.css';
import '@toron/ui/plan-action.css';
import '@toron/ui/documents.css';
import '@toron/ui/preuves.css';
import '@toron/ui/dashboard.css';
import '@toron/ui/actifs.css';
import '@toron/ui/import.css';
import '@toron/ui/incidents.css';
import '@toron/ui/nc.css';
import '@toron/ui/parametres.css';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

// Polices auto-hébergées (next/font/local) : aucun appel réseau tiers, ni au
// runtime ni au build. IBM Plex (licence OFL 1.1) vient des paquets @fontsource,
// sous-ensemble latin, fichiers figés par le lockfile.
const plexSans = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex-sans',
});

const plexMono = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'Toron',
  description:
    'Plateforme de conformité et de gestion des risques — ISO 27001, NIS 2, ISO 9001, RGPD sur un socle unique.',
};

// Applique le thème mémorisé avant le premier rendu (évite le flash). Servi
// avec le nonce de la CSP stricte (§8.1), fourni par le proxy (proxy.ts).
const themeInit = `try{var t=localStorage.getItem('toron-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // Le script de thème modifie data-theme avant l’hydratation : écart attendu.
  return (
    <html lang="fr" data-theme="dark" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        {/* Le navigateur masque la valeur du nonce dans le DOM : l’écart d’hydratation est attendu. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
