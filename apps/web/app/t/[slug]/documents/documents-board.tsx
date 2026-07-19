'use client';

import type { DocumentSummary, DocumentVersionRow, ScopeSummary, TenantMember } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';

import {
  addVersionAction,
  createDocumentAction,
  getVersionBodyAction,
  getVersionsAction,
  publishVersionAction,
  setDocumentProcessAction,
  writeVersionAction,
} from './document-actions';

type ProcessOption = { id: string; name: string };

const TYPE_LABEL: Record<string, string> = {
  pssi: 'PSSI', politique: 'Politique', procedure: 'Procédure', charte: 'Charte', pca_pra: 'PCA / PRA', fiche_processus: 'Fiche processus', autre: 'Autre',
};
function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function DocumentsBoard({ slug, canManage, documents, scopes, members, processes }: { slug: string; canManage: boolean; documents: DocumentSummary[]; scopes: ScopeSummary[]; members: TenantMember[]; processes: ProcessOption[] }) {
  const [query, setQuery] = useState('');
  const [processFilter, setProcessFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (processFilter === '__none' && d.processId) return false;
      if (processFilter && processFilter !== '__none' && d.processId !== processFilter) return false;
      if (q && !(d.title.toLowerCase().includes(q) || refCode('DOC', d.id).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [documents, query, processFilter]);
  const open = openId ? documents.find((d) => d.id === openId) ?? null : null;

  return (
    <>
      <div className="ds-toolbar">
        <div className="ds-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 20.5 20.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher — DOC-012, titre" />
        </div>
        {processes.length > 0 ? (
          <select value={processFilter} onChange={(e) => setProcessFilter(e.target.value)} aria-label="Filtrer par processus" style={{ maxWidth: 220 }}>
            <option value="">Tous les processus</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__none">— Sans processus —</option>
          </select>
        ) : null}
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouveau document</button> : null}
      </div>

      {shown.length === 0 ? (
        <div className="empty-state"><h2>Aucun document</h2><p>Créez un document et téléversez sa première version.</p></div>
      ) : (
        <div className="ds-table-card">
          <div className="ds-scroll">
            <table className="ds-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ width: 74 }}>ID</th>
                  <th style={{ minWidth: 240 }}>Document</th>
                  <th style={{ width: 130 }}>Type</th>
                  <th style={{ width: 150 }}>Processus</th>
                  <th style={{ width: 70 }}>Version</th>
                  <th style={{ width: 100 }}>Statut</th>
                  <th style={{ width: 150 }}>Propriétaire</th>
                  <th style={{ width: 150 }}>Revue</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id} onClick={() => setOpenId(d.id)}>
                    <td className="ds-id">{refCode('DOC', d.id)}</td>
                    <td><div className="ds-primary">{d.title}{d.requirementCount > 0 ? <small>{d.requirementCount} exigence{d.requirementCount > 1 ? 's' : ''} couverte{d.requirementCount > 1 ? 's' : ''}</small> : null}</div></td>
                    <td><span className="ds-chip">{TYPE_LABEL[d.type] ?? d.type}</span></td>
                    <td className="ds-muted">{d.processName ?? '—'}</td>
                    <td className="ds-mono">{d.latestSemver ? `v${d.latestSemver}` : '—'}</td>
                    <td>{d.latestStatus ? <span className={`doc-status doc-status--${d.latestStatus}`}>{d.latestStatus === 'publie' ? 'Publié' : 'Brouillon'}</span> : <span className="ds-mono">—</span>}</td>
                    <td><div className="ds-owner"><span className="ds-avatar" title={d.ownerName ?? undefined}>{initials(d.ownerName)}</span><span>{d.ownerName ?? '—'}</span></div></td>
                    <td className={`ds-mono${d.reviewOverdue ? '' : ''}`} style={{ color: d.reviewOverdue ? 'var(--danger)' : undefined, fontWeight: d.reviewOverdue ? 600 : undefined }}>{fmtDate(d.reviewDue)}{d.reviewOverdue ? ' · échue' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating ? <CreateDialog slug={slug} scopes={scopes} members={members} processes={processes} onClose={() => setCreating(false)} /> : null}
      {open ? <VersionsDrawer slug={slug} doc={open} canManage={canManage} processes={processes} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function CreateDialog({ slug, scopes, members, processes, onClose }: { slug: string; scopes: ScopeSummary[]; members: TenantMember[]; processes: ProcessOption[]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createDocumentAction(slug, { type: String(fd.get('type') ?? 'autre'), title: String(fd.get('title') ?? ''), scopeId: String(fd.get('scopeId') ?? '') || null, processId: String(fd.get('processId') ?? '') || null, ownerUserId: String(fd.get('ownerUserId') ?? '') || null, reviewDue: String(fd.get('reviewDue') ?? '') || null });
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Nouveau document" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="Politique de sécurité…" /></label>
        <div className="risk-form-grid">
          <label className="field">Type<select name="type" defaultValue="politique">{Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field">Périmètre<select name="scopeId" defaultValue={scopes[0]?.id ?? ''}><option value="">—</option>{scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="field">Processus<select name="processId" defaultValue=""><option value="">— Aucun —</option>{processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field">Propriétaire<select name="ownerUserId" defaultValue=""><option value="">— Non attribué —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          <label className="field">Date de revue<input type="date" name="reviewDue" /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Créer'}</button></div>
      </form>
    </Dialog>
  );
}

function VersionsDrawer({ slug, doc, canManage, processes, onClose }: { slug: string; doc: DocumentSummary; canManage: boolean; processes: ProcessOption[]; onClose: () => void }) {
  const router = useRouter();
  const [versions, setVersions] = useState<DocumentVersionRow[] | null>(null);
  const [nextSemver, setNextSemver] = useState('1.0');
  const [mode, setMode] = useState<'upload' | 'write'>('upload');
  const [bodyDraft, setBodyDraft] = useState('');
  const [viewing, setViewing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const semverRef = useRef<HTMLInputElement>(null);

  const reload = () => getVersionsAction(slug, { documentId: doc.id }).then((res) => { if (res.ok) { setVersions(res.data.versions); setNextSemver(res.data.nextSemver); } });
  useEffect(() => {
    let alive = true;
    getVersionsAction(slug, { documentId: doc.id }).then((res) => { if (alive && res.ok) { setVersions(res.data.versions); setNextSemver(res.data.nextSemver); } });
    return () => { alive = false; };
  }, [slug, doc.id]);

  function upload() {
    setError(null);
    const file = fileRef.current?.files?.[0];
    const semver = semverRef.current?.value ?? nextSemver;
    if (!file) { setError('Choisissez un fichier.'); return; }
    const fd = new FormData();
    fd.set('documentId', doc.id); fd.set('semver', semver); fd.set('file', file);
    start(async () => { const res = await addVersionAction(slug, fd); if (res.ok) { if (fileRef.current) fileRef.current.value = ''; await reload(); router.refresh(); } else setError(res.error.message); });
  }
  function write() {
    setError(null);
    const semver = semverRef.current?.value ?? nextSemver;
    if (bodyDraft.trim().length === 0) { setError('Le contenu est vide.'); return; }
    start(async () => { const res = await writeVersionAction(slug, { documentId: doc.id, semver, body: bodyDraft }); if (res.ok) { setBodyDraft(''); await reload(); router.refresh(); } else setError(res.error.message); });
  }
  function publish(versionId: string) {
    setError(null);
    start(async () => { const res = await publishVersionAction(slug, { versionId }); if (res.ok) { await reload(); router.refresh(); } else setError(res.error.message); });
  }
  function viewBody(versionId: string) {
    setError(null);
    getVersionBodyAction(slug, { versionId }).then((res) => { if (res.ok && res.data.body !== null) setViewing({ id: versionId, body: res.data.body }); });
  }
  function reassignProcess(processId: string | null) {
    setError(null);
    start(async () => { const res = await setDocumentProcessAction(slug, { documentId: doc.id, processId }); if (res.ok) router.refresh(); else setError(res.error?.message ?? 'Refusé.'); });
  }

  const header = (
    <>
      <span className="ds-id" id="doc-drawer-title">{refCode('DOC', doc.id)}</span>
      <span className="ds-chip">{TYPE_LABEL[doc.type] ?? doc.type}</span>
      {doc.reviewOverdue ? <span className="ds-accept-badge pending">REVUE ÉCHUE</span> : null}
    </>
  );

  return (
    <Drawer header={header} labelId="doc-drawer-title" onClose={onClose}>
      <div className="drawer-section">
        <div className="ds-primary" style={{ fontSize: 14 }}>{doc.title}</div>
        <p className="ds-muted" style={{ marginTop: 4 }}>Prochaine revue : {fmtDate(doc.reviewDue)}{doc.reviewOverdue ? ' — échue' : ''}</p>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ds-muted" style={{ fontSize: 12 }}>Processus :</span>
          {canManage ? (
            <select value={doc.processId ?? ''} disabled={pending} onChange={(e) => reassignProcess(e.target.value || null)} style={{ fontSize: 12, maxWidth: 220 }}>
              <option value="">— Aucun —</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : <span style={{ fontSize: 12.5 }}>{doc.processName ?? '—'}</span>}
        </div>
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Versions</p>
        {versions === null ? <p className="risk-mut-hint">Chargement…</p> : versions.length === 0 ? <p className="risk-mut-hint">Aucune version — téléversez la première.</p> : (
          <div className="version-list">
            {versions.map((v) => (
              <div className="version-row" key={v.id}>
                <span className="version-sem">v{v.semver}</span>
                <span className={`doc-status doc-status--${v.status}`}>{v.status === 'publie' ? 'Publié' : 'Brouillon'}</span>
                <span className="grow version-author">{v.createdByName ?? '—'} · {new Date(v.createdAt).toLocaleDateString('fr-FR')}</span>
                {v.hasContent ? <a className="link-btn" href={`/t/${slug}/documents/${v.id}`}>Télécharger</a> : null}
                {v.hasBody ? <button className="link-btn" onClick={() => viewBody(v.id)}>Voir</button> : null}
                {canManage && v.status === 'brouillon' ? <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => publish(v.id)}>Publier</button> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {viewing ? (
        <div className="drawer-section">
          <p className="drawer-section-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Contenu rédigé<button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => setViewing(null)}>Fermer</button></p>
          <pre className="doc-body-view">{viewing.body}</pre>
        </div>
      ) : null}

      {canManage ? (
        <div className="drawer-section">
          <div className="status-flow" style={{ marginBottom: 8 }}>
            <button className="btn btn-ghost btn-sm" aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>Téléverser un fichier</button>
            <button className="btn btn-ghost btn-sm" aria-pressed={mode === 'write'} onClick={() => setMode('write')}>Rédiger dans Toron</button>
          </div>
          <div className="upload-drop">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: mode === 'write' ? 8 : 0 }}>
              <label className="field" style={{ maxWidth: 110, marginBottom: 0 }}>Version<input ref={semverRef} defaultValue={nextSemver} key={nextSemver} /></label>
              {mode === 'upload' ? (
                <>
                  <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.odt,.txt,.md,.ppt,.pptx,.xls,.xlsx" />
                  <button className="btn btn-primary btn-sm" disabled={pending} onClick={upload}>{pending ? 'Téléversement…' : 'Téléverser'}</button>
                </>
              ) : null}
            </div>
            {mode === 'write' ? (
              <>
                <textarea value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} rows={10} placeholder="Rédigez le contenu du document ici (Markdown accepté)…" style={{ width: '100%', fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 12.5 }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="btn btn-primary btn-sm" disabled={pending || bodyDraft.trim().length === 0} onClick={write}>{pending ? 'Enregistrement…' : 'Enregistrer la version'}</button>
                </div>
              </>
            ) : null}
            <p className="risk-mut-hint" style={{ margin: 0 }}>Une version publiée devient immuable — créez-en une nouvelle pour modifier.</p>
          </div>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}
