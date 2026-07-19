'use client';

import { documentTemplate } from '@toron/core';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { exportDocx, printDocumentPdf } from '@/lib/document-export';
import { sanitizeDocumentHtml } from '@/lib/sanitize-html';

import { writeVersionAction } from '../../document-actions';

const TEXT_COLORS = ['#1c1e1d', '#cb4e0a', '#b23327', '#2e7d4f', '#2456b8', '#946200', '#6b21a8'];
const HILITE_COLORS = ['#fff3bf', '#ffd6cc', '#d3f9d8', '#d0ebff', '#f3d9fa', 'transparent'];

// document.execCommand est déprécié mais reste le seul éditeur riche
// auto-suffisant (aucun script externe — CSP stricte). Suffisant pour un
// éditeur documentaire (titres, gras, couleurs, listes, alignement).
function cmd(command: string, value?: string): void {
  document.execCommand(command, false, value);
}

export function DocumentEditor({
  slug,
  documentId,
  title,
  docType,
  processName,
  initialBody,
  nextSemver,
  entityMeta,
}: {
  slug: string;
  documentId: string;
  title: string;
  docType: string;
  processName: string | null;
  initialBody: string;
  nextSemver: string;
  entityMeta: string;
}) {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement>(null);
  const [semver, setSemver] = useState(nextSemver);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    // initialBody est stable pour cette page (chargé côté serveur).
    if (editorRef.current) editorRef.current.innerHTML = sanitizeDocumentHtml(initialBody);
  }, [initialBody]);

  function currentHtml(): string {
    return sanitizeDocumentHtml(editorRef.current?.innerHTML ?? '');
  }

  function save() {
    setError(null);
    setStatus(null);
    const body = currentHtml();
    if (body.replace(/<[^>]*>/g, '').trim().length === 0) { setError('Le document est vide.'); return; }
    start(async () => {
      const res = await writeVersionAction(slug, { documentId, semver, body });
      if (res.ok) { setStatus(`Version ${semver} enregistrée (brouillon).`); router.refresh(); }
      else setError(res.error.message);
    });
  }

  function insertTemplate() {
    if (editorRef.current) editorRef.current.innerHTML = sanitizeDocumentHtml(documentTemplate(docType));
  }

  // Sommaire automatique (comme Word) : construit une table des matières à
  // partir des titres H1/H2/H3 et l'insère en tête (remplace un sommaire
  // existant). Se régénère à chaque clic.
  function insertToc() {
    const editor = editorRef.current;
    if (!editor) return;
    const first = editor.firstElementChild;
    if (first && /^sommaire$/i.test((first.textContent ?? '').trim()) && /^H[12]$/.test(first.tagName)) {
      first.nextElementSibling?.remove();
      first.remove();
    }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const headings = Array.from(editor.querySelectorAll('h1, h2, h3')).filter(
      (h) => (h.textContent ?? '').trim() && !/^sommaire$/i.test((h.textContent ?? '').trim()),
    );
    if (headings.length === 0) { setError('Ajoutez d’abord des titres (H1/H2/H3) pour générer un sommaire.'); return; }
    const items = headings
      .map((h) => {
        const level = Number(h.tagName[1]);
        return `<p style="margin:2px 0">${'&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(level - 1)}${esc((h.textContent ?? '').trim())}</p>`;
      })
      .join('');
    const toc = `<h2 style="color:#cb4e0a">Sommaire</h2><div style="border-left:3px solid #e2e0d8">${items}</div><hr>`;
    editor.insertAdjacentHTML('afterbegin', sanitizeDocumentHtml(toc));
    setError(null);
    setStatus('Sommaire inséré (pensez à enregistrer).');
  }

  const meta = `${entityMeta} · Version ${semver}${processName ? ` · Processus : ${processName}` : ''}`;

  // Empêche la perte de sélection au clic sur un bouton de la barre d'outils.
  const keep = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn(); };

  return (
    <main className="app-page doc-editor-page">
      <div className="doc-editor-bar">
        <a className="btn btn-ghost btn-sm" href={`/t/${slug}/documents`}>← Documents</a>
        <span className="doc-editor-title">{title}</span>
        <span className="spacer" />
        <label className="doc-editor-semver">v<input value={semver} onChange={(e) => setSemver(e.target.value)} aria-label="Version" /></label>
        <button className="btn btn-ghost btn-sm" onClick={() => printDocumentPdf(title, meta.replace(/ · Version.*/, ''), currentHtml())}>Exporter en PDF</button>
        <button className="btn btn-ghost btn-sm" onClick={() => exportDocx(title, meta.replace(/ · Version.*/, ''), currentHtml())}>Exporter en Word</button>
        <button className="btn btn-primary btn-sm" disabled={pending} onClick={save}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>

      <div className="doc-toolbar" role="toolbar" aria-label="Mise en forme">
        <button className="tb-btn" title="Titre 1" onMouseDown={keep(() => cmd('formatBlock', 'H1'))}>H1</button>
        <button className="tb-btn" title="Titre 2" onMouseDown={keep(() => cmd('formatBlock', 'H2'))}>H2</button>
        <button className="tb-btn" title="Titre 3" onMouseDown={keep(() => cmd('formatBlock', 'H3'))}>H3</button>
        <button className="tb-btn" title="Paragraphe" onMouseDown={keep(() => cmd('formatBlock', 'P'))}>¶</button>
        <span className="tb-sep" />
        <button className="tb-btn" title="Gras" onMouseDown={keep(() => cmd('bold'))}><b>G</b></button>
        <button className="tb-btn" title="Italique" onMouseDown={keep(() => cmd('italic'))}><i>I</i></button>
        <button className="tb-btn" title="Souligné" onMouseDown={keep(() => cmd('underline'))}><u>S</u></button>
        <button className="tb-btn" title="Barré" onMouseDown={keep(() => cmd('strikeThrough'))}><s>B</s></button>
        <span className="tb-sep" />
        <button className="tb-btn" title="Liste à puces" onMouseDown={keep(() => cmd('insertUnorderedList'))}>• —</button>
        <button className="tb-btn" title="Liste numérotée" onMouseDown={keep(() => cmd('insertOrderedList'))}>1.</button>
        <button className="tb-btn" title="Aligner à gauche" onMouseDown={keep(() => cmd('justifyLeft'))}>⯇</button>
        <button className="tb-btn" title="Centrer" onMouseDown={keep(() => cmd('justifyCenter'))}>≡</button>
        <button className="tb-btn" title="Aligner à droite" onMouseDown={keep(() => cmd('justifyRight'))}>⯈</button>
        <span className="tb-sep" />
        <span className="tb-swatches" title="Couleur du texte">
          <span className="tb-swatch-label">A</span>
          {TEXT_COLORS.map((c) => (
            <button key={c} className="tb-swatch" style={{ background: c }} title={`Texte ${c}`} onMouseDown={keep(() => cmd('foreColor', c))} />
          ))}
        </span>
        <span className="tb-swatches" title="Surlignage">
          <span className="tb-swatch-label">◐</span>
          {HILITE_COLORS.map((c) => (
            <button key={c} className="tb-swatch" style={{ background: c === 'transparent' ? 'repeating-linear-gradient(45deg,#ccc,#ccc 3px,#fff 3px,#fff 6px)' : c }} title={c === 'transparent' ? 'Aucun' : `Surlignage ${c}`} onMouseDown={keep(() => cmd('hiliteColor', c))} />
          ))}
        </span>
        <span className="tb-sep" />
        <button className="tb-btn" title="Effacer la mise en forme" onMouseDown={keep(() => cmd('removeFormat'))}>⌫</button>
        <span className="spacer" />
        <button className="tb-btn" title="Insérer un sommaire (table des matières)" onMouseDown={keep(insertToc)}>Sommaire</button>
        <button className="tb-btn" title="Réinsérer le modèle du type" onMouseDown={keep(insertTemplate)}>Modèle</button>
      </div>

      <div className="doc-page-sheet">
        <div ref={editorRef} className="doc-editable" contentEditable suppressContentEditableWarning aria-label="Contenu du document" />
      </div>

      <div className="doc-editor-foot">
        {status ? <span className="doc-editor-ok">{status}</span> : null}
        {error ? <span className="form-error" role="alert" style={{ margin: 0 }}>{error}</span> : null}
        <span className="risk-mut-hint" style={{ margin: 0 }}>L’enregistrement crée une version en brouillon. Publiez-la depuis la fiche du document (une version publiée est immuable).</span>
      </div>
    </main>
  );
}
