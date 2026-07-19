'use client';

import { documentTemplate } from '@toron/core';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { exportDocx, printDocumentPdf } from '@/lib/document-export';
import { sanitizeDocumentHtml } from '@/lib/sanitize-html';

import { writeVersionAction } from '../../document-actions';

const TEXT_COLORS = ['#1c1e1d', '#cb4e0a', '#b23327', '#2e7d4f', '#2456b8', '#946200', '#6b21a8', '#ffffff'];
const HILITE_COLORS = ['#fff3bf', '#ffd6cc', '#d3f9d8', '#d0ebff', '#f3d9fa', 'transparent'];
const FONTS = [
  { label: 'Police', value: '' },
  { label: 'Sans', value: 'Segoe UI, Arial, sans-serif' },
  { label: 'Serif', value: 'Georgia, Cambria, serif' },
  { label: 'Mono', value: 'Consolas, ui-monospace, monospace' },
];
const SIZES = [
  { label: 'Taille', value: '' },
  { label: 'Petit', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Grand', value: '5' },
  { label: 'Très grand', value: '6' },
];
const BLOCKS = [
  { label: 'Normal', value: 'P' },
  { label: 'Titre 1', value: 'H1' },
  { label: 'Titre 2', value: 'H2' },
  { label: 'Titre 3', value: 'H3' },
  { label: 'Citation', value: 'BLOCKQUOTE' },
];

// document.execCommand est déprécié mais reste le seul éditeur riche
// auto-suffisant (aucun script externe — CSP stricte).
function cmd(command: string, value?: string): void {
  document.execCommand(command, false, value);
}

function wordsOf(el: HTMLElement | null): number {
  const t = (el?.textContent ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
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
  const [words, setWords] = useState(0);
  const [block, setBlock] = useState('P');
  const [active, setActive] = useState<{ bold: boolean; italic: boolean; underline: boolean }>({ bold: false, italic: false, underline: false });
  const [pending, start] = useTransition();

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = sanitizeDocumentHtml(initialBody);
      setWords(wordsOf(editorRef.current));
    }
  }, [initialBody]);

  // Reflète l'état de la sélection dans la barre (comme Word).
  const refreshState = useCallback(() => {
    if (!editorRef.current) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editorRef.current.contains(sel.anchorNode)) {
      let b = document.queryCommandValue('formatBlock').toUpperCase();
      if (!b || b === 'DIV') b = 'P';
      setBlock(b);
      setActive({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline') });
    }
  }, []);
  useEffect(() => {
    document.addEventListener('selectionchange', refreshState);
    return () => document.removeEventListener('selectionchange', refreshState);
  }, [refreshState]);

  function onEdit() {
    setWords(wordsOf(editorRef.current));
    setStatus(null);
  }

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
    if (editorRef.current) { editorRef.current.innerHTML = sanitizeDocumentHtml(documentTemplate(docType)); onEdit(); }
  }

  function addLink() {
    const raw = window.prompt('Adresse du lien (https://…)');
    if (!raw) return;
    const v = raw.trim();
    const href = /^(https?:|mailto:|#|\/)/i.test(v) ? v : `https://${v}`;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) cmd('createLink', href);
    else cmd('insertHTML', `<a href="${href.replace(/"/g, '&quot;')}">${href.replace(/</g, '&lt;')}</a>`);
    onEdit();
  }

  // Sommaire cliquable : chaque titre reçoit un id + un signet (Word), les
  // entrées du sommaire pointent vers ces ancres (liens internes cliquables
  // dans l'éditeur ET les exports PDF/Word).
  function insertToc() {
    const editor = editorRef.current;
    if (!editor) return;
    const first = editor.firstElementChild;
    if (first && /^sommaire$/i.test((first.textContent ?? '').trim()) && /^H[12]$/.test(first.tagName)) {
      const n1 = first.nextElementSibling;
      const n2 = n1?.nextElementSibling;
      if (n2 && n2.tagName === 'HR') n2.remove();
      n1?.remove();
      first.remove();
    }
    editor.querySelectorAll('a[name^="toc-"]').forEach((a) => a.remove());
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const headings = Array.from(editor.querySelectorAll('h1, h2, h3')).filter(
      (h) => (h.textContent ?? '').trim() && !/^sommaire$/i.test((h.textContent ?? '').trim()),
    ) as HTMLElement[];
    if (headings.length === 0) { setError('Ajoutez d’abord des titres (H1/H2/H3) pour générer un sommaire.'); return; }
    headings.forEach((h, i) => {
      const id = `toc-${i + 1}`;
      h.id = id;
      const bm = document.createElement('a');
      bm.setAttribute('name', id);
      h.insertBefore(bm, h.firstChild);
    });
    const items = headings
      .map((h, i) => {
        const level = Number(h.tagName[1]);
        return `<p style="margin:3px 0">${'&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(level - 1)}<a href="#toc-${i + 1}">${esc((h.textContent ?? '').trim())}</a></p>`;
      })
      .join('');
    const toc = `<h2 style="color:#cb4e0a">Sommaire</h2><div style="border-left:3px solid #e2e0d8;padding-left:12px">${items}</div><hr>`;
    editor.insertAdjacentHTML('afterbegin', sanitizeDocumentHtml(toc));
    setError(null);
    setStatus('Sommaire inséré, liens cliquables (pensez à enregistrer).');
    onEdit();
  }

  const meta = `${entityMeta}${processName ? ` · Processus : ${processName}` : ''}`;
  const keep = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn(); refreshState(); };

  return (
    <main className="app-page doc-editor-page">
      <div className="doc-editor-bar">
        <a className="btn btn-ghost btn-sm" href={`/t/${slug}/documents`}>← Documents</a>
        <span className="doc-editor-title">{title}</span>
        <span className="spacer" />
        <label className="doc-editor-semver">v<input value={semver} onChange={(e) => setSemver(e.target.value)} aria-label="Version" /></label>
        <button className="btn btn-ghost btn-sm" onClick={() => printDocumentPdf(title, meta, currentHtml())}>Exporter en PDF</button>
        <button className="btn btn-ghost btn-sm" onClick={() => exportDocx(title, meta, currentHtml())}>Exporter en Word</button>
        <button className="btn btn-primary btn-sm" disabled={pending} onClick={save}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>

      <div className="doc-toolbar" role="toolbar" aria-label="Mise en forme">
        <button className="tb-btn" title="Annuler (Ctrl+Z)" onMouseDown={keep(() => cmd('undo'))}>↶</button>
        <button className="tb-btn" title="Rétablir (Ctrl+Y)" onMouseDown={keep(() => cmd('redo'))}>↷</button>
        <span className="tb-sep" />
        <select className="tb-select" title="Style de paragraphe" value={block} onChange={(e) => { cmd('formatBlock', e.target.value); refreshState(); }} onMouseDown={(e) => e.stopPropagation()}>
          {BLOCKS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <select className="tb-select" title="Police" defaultValue="" onChange={(e) => { if (e.target.value) cmd('fontName', e.target.value); e.currentTarget.selectedIndex = 0; }}>
          {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <select className="tb-select" title="Taille" defaultValue="" onChange={(e) => { if (e.target.value) cmd('fontSize', e.target.value); e.currentTarget.selectedIndex = 0; }}>
          {SIZES.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
        </select>
        <span className="tb-sep" />
        <button className={`tb-btn${active.bold ? ' on' : ''}`} title="Gras (Ctrl+B)" onMouseDown={keep(() => cmd('bold'))}><b>G</b></button>
        <button className={`tb-btn${active.italic ? ' on' : ''}`} title="Italique (Ctrl+I)" onMouseDown={keep(() => cmd('italic'))}><i>I</i></button>
        <button className={`tb-btn${active.underline ? ' on' : ''}`} title="Souligné (Ctrl+U)" onMouseDown={keep(() => cmd('underline'))}><u>S</u></button>
        <button className="tb-btn" title="Barré" onMouseDown={keep(() => cmd('strikeThrough'))}><s>B</s></button>
        <span className="tb-swatches" title="Couleur du texte">
          <span className="tb-swatch-label">A</span>
          {TEXT_COLORS.map((c) => <button key={c} className="tb-swatch" style={{ background: c }} title={`Texte ${c}`} onMouseDown={keep(() => cmd('foreColor', c))} />)}
        </span>
        <span className="tb-swatches" title="Surlignage">
          <span className="tb-swatch-label">◐</span>
          {HILITE_COLORS.map((c) => <button key={c} className="tb-swatch" style={{ background: c === 'transparent' ? 'repeating-linear-gradient(45deg,#ccc,#ccc 3px,#fff 3px,#fff 6px)' : c }} title={c === 'transparent' ? 'Aucun' : `Surlignage ${c}`} onMouseDown={keep(() => cmd('hiliteColor', c))} />)}
        </span>
        <span className="tb-sep" />
        <button className="tb-btn" title="Liste à puces" onMouseDown={keep(() => cmd('insertUnorderedList'))}>• —</button>
        <button className="tb-btn" title="Liste numérotée" onMouseDown={keep(() => cmd('insertOrderedList'))}>1.</button>
        <button className="tb-btn" title="Diminuer le retrait" onMouseDown={keep(() => cmd('outdent'))}>⇤</button>
        <button className="tb-btn" title="Augmenter le retrait" onMouseDown={keep(() => cmd('indent'))}>⇥</button>
        <span className="tb-sep" />
        <button className="tb-btn" title="Aligner à gauche" onMouseDown={keep(() => cmd('justifyLeft'))}>⯇</button>
        <button className="tb-btn" title="Centrer" onMouseDown={keep(() => cmd('justifyCenter'))}>≡</button>
        <button className="tb-btn" title="Aligner à droite" onMouseDown={keep(() => cmd('justifyRight'))}>⯈</button>
        <button className="tb-btn" title="Justifier" onMouseDown={keep(() => cmd('justifyFull'))}>▤</button>
        <span className="tb-sep" />
        <button className="tb-btn" title="Insérer un lien" onMouseDown={keep(addLink)}>🔗</button>
        <button className="tb-btn" title="Trait horizontal" onMouseDown={keep(() => cmd('insertHorizontalRule'))}>―</button>
        <button className="tb-btn" title="Effacer la mise en forme" onMouseDown={keep(() => cmd('removeFormat'))}>⌫</button>
        <span className="spacer" />
        <button className="tb-btn tb-text" title="Insérer un sommaire cliquable" onMouseDown={keep(insertToc)}>Sommaire</button>
        <button className="tb-btn tb-text" title="Réinsérer le modèle du type" onMouseDown={keep(insertTemplate)}>Modèle</button>
      </div>

      <div className="doc-page-sheet">
        <div ref={editorRef} className="doc-editable" contentEditable suppressContentEditableWarning aria-label="Contenu du document" onInput={onEdit} onKeyUp={refreshState} onMouseUp={refreshState} />
      </div>

      <div className="doc-editor-statusbar">
        <span>{words} mot{words > 1 ? 's' : ''}</span>
        <span className="spacer" />
        {status ? <span className="doc-editor-ok">{status}</span> : null}
        {error ? <span className="form-error" role="alert" style={{ margin: 0 }}>{error}</span> : null}
        {!status && !error ? <span className="risk-mut-hint" style={{ margin: 0 }}>Brouillon — publiez la version depuis la fiche du document (une version publiée est immuable).</span> : null}
      </div>
    </main>
  );
}
