// Export de documents côté client — sans dépendance externe (CSP stricte).
//  · PDF : ouverture d'une fenêtre d'impression mise en page A4 → « Enregistrer
//    en PDF » du navigateur (couleurs préservées).
//  · Word : blob application/msword (HTML compatible Word), ouvrable et
//    éditable dans Word / LibreOffice avec les couleurs et la mise en forme.

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'document';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PAGE_CSS = `
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1c1e1d; line-height: 1.55; margin: 0; }
  .page { max-width: 720px; margin: 0 auto; padding: 32px 40px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 18px 0 6px; }
  h3 { font-size: 13px; margin: 14px 0 4px; }
  p, li { font-size: 12.5px; }
  ul, ol { padding-left: 22px; }
  a { color: #cb4e0a; text-decoration: underline; }
  blockquote { margin: 8px 0; padding: 4px 0 4px 14px; border-left: 3px solid #cfd1ce; color: #444; }
  hr { border: none; border-top: 1px solid #e2e0d8; margin: 16px 0; }
  h1, h2, h3 { page-break-after: avoid; }
  .doc-meta { color: #7a7c73; font-size: 11px; border-bottom: 1px solid #e2e0d8; padding-bottom: 10px; margin-bottom: 16px; }
  @page { size: A4; margin: 18mm; }
`;

function documentHtml(title: string, meta: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body><div class="page"><div class="doc-meta">${escapeHtml(meta)}</div>${bodyHtml}</div></body></html>`;
}

/**
 * Rend la mise en page A4 dans un iframe caché et déclenche l'impression
 * (→ « Enregistrer en PDF »). L'iframe contourne les bloqueurs de fenêtres
 * pop-up qui neutralisaient window.open.
 */
export function printDocumentPdf(title: string, meta: string, bodyHtml: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(documentHtml(title, meta, bodyHtml));
  doc.close();
  const cw = iframe.contentWindow!;
  let removed = false;
  const cleanup = () => { if (!removed) { removed = true; setTimeout(() => iframe.remove(), 500); } };
  cw.onafterprint = cleanup;
  // Laisse le temps au rendu (styles/polices) avant l'impression.
  setTimeout(() => { cw.focus(); cw.print(); cleanup(); }, 350);
}

/** Télécharge le document au format Word (.doc, HTML compatible Word). */
export function exportDocx(title: string, meta: string, bodyHtml: string): void {
  const header =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
    `<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body><div class="page"><div class="doc-meta">${escapeHtml(meta)}</div>`;
  const footer = '</div></body></html>';
  const bom = String.fromCharCode(0xfeff);
  const source = `${bom}${header}${bodyHtml}${footer}`;
  const blob = new Blob([source], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(title)}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}
