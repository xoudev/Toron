import { describe, expect, it } from 'vitest';

import { HEADER_TEXT_MAX, escapeHtml, headerText, looksLikeLink, parisDateTime } from './text.ts';

describe('escapeHtml', () => {
  it('échappe les cinq caractères actifs', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});

describe('headerText', () => {
  it('neutralise CR/LF : aucune injection d’en-tête', () => {
    expect(headerText('Objet\r\nBcc: pirate@exemple.fr')).toBe('Objet Bcc: pirate@exemple.fr');
    expect(headerText('a\nb\tc\u0000d')).toBe('a b c d');
  });

  it('retire les marques bidi U+202E et U+2066 et les caractères de format', () => {
    expect(headerText('facture\u202efdp.exe')).toBe('facturefdp.exe');
    expect(headerText('\u2066Meridiane\u2069 Logistics\u200b')).toBe('Meridiane Logistics');
  });

  it('ramène les sauts Unicode à un espace et replie les espaces', () => {
    expect(headerText('  un\u2028deux\u2029trois   quatre ')).toBe('un deux trois quatre');
  });

  it('tronque avec une ellipse, sans couper un caractère', () => {
    expect(headerText('x'.repeat(HEADER_TEXT_MAX))).toHaveLength(HEADER_TEXT_MAX);
    const long = headerText('é'.repeat(300));
    expect(Array.from(long)).toHaveLength(HEADER_TEXT_MAX);
    expect(long.endsWith('…')).toBe(true);
    expect(headerText('😀'.repeat(10), 5)).toBe('😀😀😀😀…');
    expect(headerText('Meridiane Logistics', 10)).toBe('Meridiane…');
  });
});

describe('looksLikeLink', () => {
  it.each([
    'https://exemple-piege.fr',
    'www.exemple-piege.fr',
    'exemple-piege.fr',
    'Meridiane (meridiane-logistics.eu)',
    'contact@exemple.fr',
    'javascript://x',
    'Société\u200b.fr',
  ])('%s ressemble à un lien', (value) => {
    expect(looksLikeLink(value)).toBe(true);
  });

  it.each(['Meridiane Logistics', 'Version 2.1', 'S.A. Meridiane', 'Logistique & Transport', 'Ex. dossier'])(
    '%s n’en est pas un', (value) => {
      expect(looksLikeLink(value)).toBe(false);
    },
  );
});

describe('parisDateTime', () => {
  it('date et heure de Paris, en toutes lettres', () => {
    expect(parisDateTime(new Date('2026-10-10T12:32:00Z'))).toBe('10 octobre 2026 à 14\u202fh\u202f32 (heure de Paris)');
  });

  it('heure d’hiver, premier du mois et minuit', () => {
    expect(parisDateTime(new Date('2026-12-01T08:05:00Z'))).toBe('1er décembre 2026 à 9\u202fh\u202f05 (heure de Paris)');
    expect(parisDateTime(new Date('2027-01-14T23:00:00Z'))).toBe('15 janvier 2027 à 0\u202fh\u202f00 (heure de Paris)');
  });
});
