import { describe, expect, it } from 'vitest';
import {
  MAX_HEADER_LINE_LENGTH,
  contentSecurityPolicy,
  headersFile,
  inlineScriptHashes,
} from './security-headers.ts';

// sha256("alert(1)") en base64, calculé hors du code testé.
const ALERT_HASH = `'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='`;

describe('inlineScriptHashes', () => {
  it('hache le contenu exact des scripts inline', () => {
    expect(inlineScriptHashes('<p>x</p><script>alert(1)</script>')).toEqual([ALERT_HASH]);
  });

  it('ignore les scripts externes, y compris avec des attributs multiples', () => {
    const html = '<script src="/a.js" async=""></script><SCRIPT async src=/b.js></SCRIPT>';
    expect(inlineScriptHashes(html)).toEqual([]);
  });

  it('ne confond pas data-src avec src', () => {
    expect(inlineScriptHashes('<script data-src="/x.js">alert(1)</script>')).toEqual([ALERT_HASH]);
  });

  it('traite chaque script inline séparément', () => {
    expect(inlineScriptHashes('<script>alert(1)</script>\n<script id="b">alert(1)</script>')).toHaveLength(2);
  });
});

describe('contentSecurityPolicy', () => {
  it("n'autorise jamais 'unsafe-inline' ni 'unsafe-eval' pour les scripts", () => {
    const scriptSrc = contentSecurityPolicy([ALERT_HASH])
      .split('; ')
      .find((directive) => directive.startsWith('script-src'));
    expect(scriptSrc).toBe(`script-src 'self' ${ALERT_HASH}`);
  });

  it('déduplique et trie les empreintes (sortie déterministe)', () => {
    const b = `'sha256-B'`;
    const a = `'sha256-A'`;
    expect(contentSecurityPolicy([b, a, b])).toContain(`script-src 'self' ${a} ${b};`);
  });

  it('interdit tout par défaut, le framing et les formulaires', () => {
    const csp = contentSecurityPolicy([]);
    expect(csp).toContain(`default-src 'none'`);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain(`form-action 'none'`);
    expect(csp).toContain(`base-uri 'none'`);
  });
});

describe('headersFile', () => {
  it('applique les en-têtes durcis à toutes les routes', () => {
    const file = headersFile([ALERT_HASH]);
    expect(file).toMatch(/^\/\*$/m);
    expect(file).toContain(`  Content-Security-Policy: default-src 'none';`);
    expect(file).toContain('  Strict-Transport-Security: max-age=63072000; includeSubDomains\n');
    expect(file).toContain('  X-Frame-Options: DENY');
    expect(file).toContain('  X-Content-Type-Options: nosniff');
  });

  it('désindexe les URL techniques *.pages.dev', () => {
    expect(headersFile([])).toContain('https://:project.pages.dev/*\n  X-Robots-Tag: noindex');
  });

  it('échoue explicitement au-delà de la limite de ligne Cloudflare', () => {
    const many = Array.from({ length: 60 }, (_, i) => `'sha256-${String(i).padStart(44, '0')}'`);
    expect(() => headersFile(many)).toThrow(/trop longue/);
    expect(headersFile(many.slice(0, 5)).split('\n').every((line) => line.length <= MAX_HEADER_LINE_LENGTH)).toBe(true);
  });
});
