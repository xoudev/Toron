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

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

// Polices auto-hébergées au build (next/font) : aucun appel réseau tiers
// au runtime — cohérent avec la souveraineté et la future CSP stricte.
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'Toron',
  description:
    'Plateforme de conformité et de gestion des risques — ISO 27001, NIS 2, ISO 9001, RGPD sur un socle unique.',
};

// Applique le thème mémorisé avant le premier rendu (évite le flash). Servi
// avec le nonce de la CSP stricte (§8.1), fourni par le middleware.
const themeInit = `try{var t=localStorage.getItem('toron-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="fr" data-theme="dark" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
