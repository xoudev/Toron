import { describe, expect, it } from 'vitest';

import { DOCUMENT_TEMPLATES, canEditVersion, documentTemplate, hardenDocumentHtml, nextSemver, reviewOverdue } from './documents.ts';

describe('immuabilité d’une version publiée (RM §5.6)', () => {
  it('seul un brouillon est modifiable', () => {
    expect(canEditVersion('brouillon')).toBe(true);
    expect(canEditVersion('publie')).toBe(false);
  });
});

describe('nextSemver', () => {
  it('incrémente la mineure, 1.0 si aucune version', () => {
    expect(nextSemver(null)).toBe('1.0');
    expect(nextSemver('2.4')).toBe('2.5');
    expect(nextSemver('v1.0')).toBe('1.1');
    expect(nextSemver('3')).toBe('3.1');
    expect(nextSemver('bidon')).toBe('1.0');
  });
});

describe('alerte de revue', () => {
  const today = new Date('2026-07-18T10:00:00Z');
  it('dépassée si strictement antérieure à aujourd’hui', () => {
    expect(reviewOverdue(new Date('2026-06-30'), today)).toBe(true);
    expect(reviewOverdue(new Date('2026-07-18'), today)).toBe(false);
    expect(reviewOverdue(new Date('2026-08-01'), today)).toBe(false);
    expect(reviewOverdue(null, today)).toBe(false);
  });
});

describe('modèles de documents par type', () => {
  it('fournit un modèle HTML riche pour chaque type', () => {
    for (const type of Object.keys(DOCUMENT_TEMPLATES)) {
      const html = documentTemplate(type);
      expect(html).toContain('<h1');
      expect(html.length).toBeGreaterThan(50);
    }
    expect(documentTemplate('type_inconnu')).toBe(DOCUMENT_TEMPLATES.autre.html);
  });
});

describe('durcissement HTML (anti-XSS stocké)', () => {
  it('retire scripts, styles et gestionnaires d’événements, garde le contenu riche', () => {
    const dirty = '<h1 style="color:#cb4e0a">Titre</h1><script>alert(1)</script><p onclick="steal()">Texte</p><img src="x" onerror="hack()"><a href="javascript:evil()">lien</a>';
    const clean = hardenDocumentHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
    // Le contenu légitime et la couleur sont préservés.
    expect(clean).toContain('<h1 style="color:#cb4e0a">Titre</h1>');
    expect(clean).toContain('Texte');
  });
});
