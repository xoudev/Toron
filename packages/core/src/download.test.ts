import { describe, expect, it } from 'vitest';

import { attachmentDisposition } from './download.ts';

describe('nom du fichier téléchargé', () => {
  it('garde les accents, avec un repli ASCII sans accents', () => {
    expect(attachmentDisposition('Procédure de sauvegarde.pdf', 'preuve')).toBe(
      `attachment; filename="Procedure de sauvegarde.pdf"; filename*=UTF-8''Proc%C3%A9dure%20de%20sauvegarde.pdf`,
    );
    expect(attachmentDisposition('Politique sécurité.docx', 'document')).toContain('filename="Politique securite.docx"');
  });
  it('encode les caractères que RFC 5987 n’admet pas tels quels', () => {
    expect(attachmentDisposition('Rapport (v2) d’audit*.pdf', 'preuve')).toContain(`filename*=UTF-8''Rapport%20%28v2%29%20d%E2%80%99audit%2A.pdf`);
  });
  it('retire guillemets et retours à la ligne, qui casseraient l’en-tête', () => {
    expect(attachmentDisposition('a"b\r\nc\\.pdf', 'preuve')).toBe(`attachment; filename="abc.pdf"; filename*=UTF-8''abc.pdf`);
  });
  it('prend le nom de repli quand il n’y a pas de nom', () => {
    expect(attachmentDisposition(null, 'preuve')).toBe(`attachment; filename="preuve"; filename*=UTF-8''preuve`);
    expect(attachmentDisposition('  ', 'document')).toContain('filename="document"');
  });
  it('tronque à 120 caractères sans couper un caractère', () => {
    // Décalage impair : une coupe en unités UTF-16 tomberait au milieu d'une paire.
    const header = attachmentDisposition('a' + '📎'.repeat(200) + '.pdf', 'preuve');
    const encoded = header.split("filename*=UTF-8''")[1]!;
    expect(Array.from(decodeURIComponent(encoded))).toHaveLength(120);
  });
});
