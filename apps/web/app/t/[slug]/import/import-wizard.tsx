'use client';

import {
  TARGET_SPECS,
  csvTemplate,
  detectMapping,
  parseDelimited,
  validateRows,
  type ColumnMapping,
  type ImportTarget,
  type ParsedTable,
  type RejectedRow,
} from '@toron/core';
import { useMemo, useRef, useState, useTransition } from 'react';

import { applyImportAction } from './import-actions';

const TARGET_LABEL: Record<ImportTarget, string> = { risk: 'Risques', action: 'Actions', asset: 'Actifs' };
const STEPS = ['Dépôt', 'Correspondances', 'Résolution', 'Confirmation'] as const;

/** Devine la cible dont la détection couvre le mieux les champs requis. */
function guessTarget(headers: string[]): ImportTarget {
  let best: ImportTarget = 'risk';
  let bestScore = -1;
  for (const t of Object.keys(TARGET_SPECS) as ImportTarget[]) {
    const map = detectMapping(headers, t);
    const req = TARGET_SPECS[t].fields.filter((f) => f.required).map((f) => f.field);
    const reqHit = map.filter((m) => req.includes(m.field) && m.columnIndex !== null).length;
    const score = reqHit * 10 + map.filter((m) => m.columnIndex !== null).length;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

export function ImportWizard({ slug }: { slug: string }) {
  const [step, setStep] = useState(0);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [target, setTarget] = useState<ImportTarget>('risk');
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [result, setResult] = useState<{ imported: number; rejected: { line: number; cause: string; suggestion: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(file: File) {
    setParseError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const parsed = parseDelimited(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setParseError('Fichier illisible ou vide. Attendu : un CSV/TSV (export Excel « Enregistrer sous → CSV ») avec une ligne d’en-tête.');
        return;
      }
      const t = guessTarget(parsed.headers);
      setTable(parsed);
      setFileName(file.name);
      setTarget(t);
      setMapping(detectMapping(parsed.headers, t));
      setStep(1);
    };
    reader.onerror = () => setParseError('Lecture du fichier impossible.');
    reader.readAsText(file);
  }

  function changeTarget(t: ImportTarget) {
    setTarget(t);
    if (table) setMapping(detectMapping(table.headers, t));
  }
  function downloadTemplate(t: ImportTarget) {
    const blob = new Blob(['﻿' + csvTemplate(t)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modele-toron-${t === 'risk' ? 'risques' : t === 'action' ? 'actions' : 'actifs'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function setCol(field: string, columnIndex: number | null) {
    setMapping((m) => m.map((x) => (x.field === field ? { ...x, columnIndex, confidence: columnIndex === null ? 0 : 1 } : x)));
  }

  const validation = useMemo(() => (table ? validateRows(table.rows, target, mapping) : null), [table, target, mapping]);
  const preview = table ? table.rows.slice(0, 5) : [];

  function apply() {
    if (!table) return;
    setError(null);
    start(async () => {
      const res = await applyImportAction(slug, { target, rows: table.rows, mapping });
      if (res.ok) { setResult(res.data); setStep(3); } else setError(res.error.message);
    });
  }

  return (
    <>
      <div className="wiz-steps">
        {STEPS.map((s, i) => (
          <span key={s} style={{ display: 'contents' }}>
            {i > 0 ? <span className="wiz-sep" /> : null}
            <span className={`wiz-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}><b>{i + 1}</b>{s}</span>
          </span>
        ))}
      </div>

      {step === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <div className="drop-zone">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--text-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4M8 8l4-4 4 4M4 17v3h16v-3" /></svg>
            <h3>Déposez votre classeur</h3>
            <p>CSV / TSV (depuis Excel : « Enregistrer sous → CSV UTF-8 »). Risques, actions ou actifs.</p>
            <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>Parcourir…</button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </div>
          {parseError ? <p className="form-error" role="alert" style={{ marginTop: 12 }}>{parseError}</p> : null}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-2)' }}>
              Pas sûr du format ? Téléchargez un modèle pré-rempli, complétez-le dans Excel, puis déposez-le ici.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('risk')}>↓ Modèle risques</button>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('action')}>↓ Modèle actions</button>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('asset')}>↓ Modèle actifs</button>
            </div>
          </div>
          <p className="reassure" style={{ marginTop: 14 }}>Vos années de travail sous Excel ne sont pas perdues — elles deviennent votre socle.</p>
        </div>
      ) : null}

      {step === 1 && table ? (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="file-chip">📄 {fileName} · {table.rows.length} ligne{table.rows.length > 1 ? 's' : ''}</span>
            <label className="field" style={{ margin: 0, minWidth: 160 }}>Type d’objet
              <select value={target} onChange={(e) => changeTarget(e.target.value as ImportTarget)}>
                {(Object.keys(TARGET_LABEL) as ImportTarget[]).map((t) => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
              </select>
            </label>
          </div>

          <p className="drawer-section-label">Vérifiez les correspondances</p>
          <div className="map-grid" style={{ marginBottom: 16 }}>
            <span className="head">Champ Toron</span><span className="head">Colonne du fichier</span><span className="head">Confiance</span>
            {mapping.map((m) => (
              <span key={m.field} style={{ display: 'contents' }}>
                <span style={{ fontSize: 12.5 }}>{m.label}{TARGET_SPECS[target].fields.find((f) => f.field === m.field)?.required ? ' *' : ''}</span>
                <select value={m.columnIndex ?? ''} onChange={(e) => setCol(m.field, e.target.value === '' ? null : Number(e.target.value))}>
                  <option value="">— Ignorer —</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h || `Colonne ${i + 1}`}</option>)}
                </select>
                <span className={`conf ${m.confidence >= 1 ? 'high' : m.confidence > 0 ? 'mid' : 'none'}`}>{m.confidence > 0 ? `${Math.round(m.confidence * 100)}%` : '—'}</span>
              </span>
            ))}
          </div>

          <p className="drawer-section-label">Aperçu — 5 premières lignes</p>
          <div className="ds-table-card"><div className="ds-scroll">
            <table className="ds-table"><thead><tr>{table.headers.map((h, i) => <th key={i}>{h || `Col ${i + 1}`}</th>)}</tr></thead>
              <tbody>{preview.map((row, i) => <tr key={i} style={{ cursor: 'default' }}>{table.headers.map((_, j) => <td key={j} className="ds-muted">{row[j] ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </div></div>

          <div className="dialog-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setStep(0); setTable(null); }}>Précédent</button>
            <button className="btn btn-primary btn-sm" onClick={() => setStep(2)}>Continuer</button>
          </div>
        </div>
      ) : null}

      {step === 2 && validation ? (
        <div className="card" style={{ padding: 18 }}>
          <div className="ds-stat-row">
            <div className="ds-stat"><span className="ds-stat-value">{validation.rows.length}</span><span className="ds-stat-label">ligne{validation.rows.length > 1 ? 's' : ''} prête{validation.rows.length > 1 ? 's' : ''}</span></div>
            <div className="ds-stat"><span className={`ds-stat-value${validation.rejected.length > 0 ? ' alert' : ''}`}>{validation.rejected.length}</span><span className="ds-stat-label">en écart</span></div>
          </div>
          {validation.rejected.length > 0 ? (
            <>
              <p className="drawer-section-label">Résolvons les lignes en écart</p>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {validation.rejected.map((r: RejectedRow) => (
                  <div className="resolve-row" key={r.line}>
                    <span className="line">Ligne {r.line}</span>
                    <div className="cause">{r.cause}</div>
                    <div className="fix">Correction proposée : {r.suggestion}</div>
                  </div>
                ))}
              </div>
              <p className="reassure">Ces lignes seront ignorées à l’import. Corrigez-les dans le fichier source puis réimportez — rien n’est perdu en silence.</p>
            </>
          ) : (
            <p className="ds-muted">Toutes les lignes sont valides. 🎉</p>
          )}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>Précédent</button>
            <button className="btn btn-primary btn-sm" disabled={pending || validation.rows.length === 0} onClick={apply}>{pending ? 'Import…' : `Importer ${validation.rows.length} ligne${validation.rows.length > 1 ? 's' : ''}`}</button>
          </div>
        </div>
      ) : null}

      {step === 3 && result ? (
        <div className="card">
          <div className="wiz-done">
            <div className="big">{result.imported}</div>
            <h3 style={{ margin: '4px 0' }}>{TARGET_LABEL[target].toLowerCase()} importé{result.imported > 1 ? 's' : ''} — bienvenue sur votre socle</h3>
            {result.rejected.length > 0 ? <p className="ds-muted">{result.rejected.length} ligne{result.rejected.length > 1 ? 's' : ''} ignorée{result.rejected.length > 1 ? 's' : ''} (voir les causes ci-dessus).</p> : null}
            <div className="dialog-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
              <a className="btn btn-primary btn-sm" href={target === 'risk' ? `/t/${slug}/risques` : target === 'action' ? `/t/${slug}/plan-action` : `/t/${slug}/actifs`}>Ouvrir le registre rempli</a>
              <button className="btn btn-ghost btn-sm" onClick={() => { setStep(0); setTable(null); setResult(null); }}>Importer un autre fichier</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
