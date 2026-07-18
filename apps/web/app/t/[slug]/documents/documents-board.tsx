'use client';

import type { DocumentSummary, DocumentVersionRow, ScopeSummary, TenantMember } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';

import {
  addVersionAction,
  createDocumentAction,
  getVersionsAction,
  publishVersionAction,
} from './document-actions';

const TYPE_LABEL: Record<string, string> = {
  pssi: 'PSSI', politique: 'Politique', procedure: 'Procédure', charte: 'Charte', pca_pra: 'PCA / PRA', fiche_processus: 'Fiche processus', autre: 'Autre',
};
function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function DocumentsBoard({ slug, canManage, documents, scopes, members }: { slug: string; canManage: boolean; documents: DocumentSummary[]; scopes: ScopeSummary[]; members: TenantMember[] }) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => d.title.toLowerCase().includes(q) || refCode('DOC', d.id).toLowerCase().includes(q));
  }, [documents, query]);
  const open = openId ? documents.find((d) => d.id === openId) ?? null : null;

  return (
    <>
      <div className="ds-toolbar">
        <div className="ds-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 20.5 20.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher — DOC-012, titre" />
        </div>
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
                  <th style={{ minWidth: 260 }}>Document</th>
                  <th style={{ width: 130 }}>Type</th>
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

      {creating ? <CreateDialog slug={slug} scopes={scopes} members={members} onClose={() => setCreating(false)} /> : null}
      {open ? <VersionsDrawer slug={slug} doc={open} canManage={canManage} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function CreateDialog({ slug, scopes, members, onClose }: { slug: string; scopes: ScopeSummary[]; members: TenantMember[]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createDocumentAction(slug, { type: String(fd.get('type') ?? 'autre'), title: String(fd.get('title') ?? ''), scopeId: String(fd.get('scopeId') ?? '') || null, ownerUserId: String(fd.get('ownerUserId') ?? '') || null, reviewDue: String(fd.get('reviewDue') ?? '') || null });
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
          <label className="field">Propriétaire<select name="ownerUserId" defaultValue=""><option value="">— Non attribué —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          <label className="field">Date de revue<input type="date" name="reviewDue" /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Créer'}</button></div>
      </form>
    </Dialog>
  );
}

function VersionsDrawer({ slug, doc, canManage, onClose }: { slug: string; doc: DocumentSummary; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [versions, setVersions] = useState<DocumentVersionRow[] | null>(null);
  const [nextSemver, setNextSemver] = useState('1.0');
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
  function publish(versionId: string) {
    setError(null);
    start(async () => { const res = await publishVersionAction(slug, { versionId }); if (res.ok) { await reload(); router.refresh(); } else setError(res.error.message); });
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
                {canManage && v.status === 'brouillon' ? <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => publish(v.id)}>Publier</button> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Nouvelle version</p>
          <div className="upload-drop">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="field" style={{ maxWidth: 110 }}>Version<input ref={semverRef} defaultValue={nextSemver} key={nextSemver} /></label>
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.odt,.txt,.md,.ppt,.pptx,.xls,.xlsx" />
              <button className="btn btn-primary btn-sm" disabled={pending} onClick={upload}>{pending ? 'Téléversement…' : 'Téléverser'}</button>
            </div>
            <p className="risk-mut-hint" style={{ margin: 0 }}>Une version publiée devient immuable — créez-en une nouvelle pour modifier.</p>
          </div>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}
