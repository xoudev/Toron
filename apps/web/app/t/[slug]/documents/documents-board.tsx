'use client';

import { DOCUMENT_TEMPLATES, DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL, acknowledgementProgress } from '@toron/core';
import type { DocumentSummary, DocumentVersionRow, ScopeSummary, TenantMember } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';

import { exportDocx } from '@/lib/document-export';
import { initials, refCode } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { sanitizeDocumentHtml } from '@/lib/sanitize-html';
import { useOpenItem } from '@/lib/use-open-item';

import {
  acknowledgeDocumentAction,
  addVersionAction,
  createDocumentAction,
  getAcknowledgementsAction,
  setAcknowledgementRequiredAction,
  type AcknowledgementView,
  getVersionBodyAction,
  getVersionsAction,
  publishVersionAction,
  setDocumentProcessAction,
  updateDocumentAction,
} from './document-actions';

type ProcessOption = { id: string; name: string };

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

function onEnter(e: KeyboardEvent<HTMLTableRowElement>, open: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open();
  }
}

export function DocumentsBoard({ slug, canManage, currentUserId, documents, scopes, members, processes }: { slug: string; canManage: boolean; currentUserId: string; documents: DocumentSummary[]; scopes: ScopeSummary[]; members: TenantMember[]; processes: ProcessOption[] }) {
  const [query, setQuery] = useState('');
  const [processFilter, setProcessFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [openId, setOpenId] = useOpenItem(documents.map((x) => x.id));
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
        <button className="btn btn-ghost btn-sm" onClick={() => setTemplatesOpen(true)}>Modèles</button>
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
                  <th style={{ width: 110 }}>Lecture</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id} tabIndex={0} onClick={() => setOpenId(d.id)} onKeyDown={(e) => onEnter(e, () => setOpenId(d.id))}>
                    <td className="ds-id">{refCode('DOC', d.id)}</td>
                    <td><div className="ds-primary">{d.title}{d.requirementCount > 0 ? <small>{d.requirementCount} exigence{d.requirementCount > 1 ? 's' : ''} couverte{d.requirementCount > 1 ? 's' : ''}</small> : null}</div></td>
                    <td><span className="ds-chip">{DOCUMENT_TYPE_LABEL[d.type]}</span></td>
                    <td className="ds-muted">{d.processName ?? '—'}</td>
                    <td className="ds-mono">{d.latestSemver ? `v${d.latestSemver}` : '—'}</td>
                    <td>{d.latestStatus ? <span className={`doc-status doc-status--${d.latestStatus}`}>{d.latestStatus === 'publie' ? 'Publié' : 'Brouillon'}</span> : <span className="ds-mono">—</span>}</td>
                    <td><div className="ds-owner"><span className="ds-avatar" title={d.ownerName ?? undefined}>{initials(d.ownerName)}</span><span>{d.ownerName ?? '—'}</span></div></td>
                    <td className={`ds-mono${d.reviewOverdue ? '' : ''}`} style={{ color: d.reviewOverdue ? 'var(--danger)' : undefined, fontWeight: d.reviewOverdue ? 600 : undefined }}>{fmtDate(d.reviewDue)}{d.reviewOverdue ? ' · échue' : ''}</td>
                    <td>{d.acknowledgementRequired && d.publishedVersionId ? (
                      <span className={`ds-chip${acknowledgementProgress(d.ackCount, d.memberCount).complete ? '' : ' accent'}`} title={`Acceptations de la v${d.publishedSemver} : ${d.ackCount} sur ${d.memberCount}`}>
                        {d.ackCount}/{d.memberCount}
                      </span>
                    ) : d.acknowledgementRequired ? <span className="ds-muted">À publier</span> : <span className="ds-mono">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {templatesOpen ? <TemplatesDialog onClose={() => setTemplatesOpen(false)} /> : null}
      {creating ? <CreateDialog slug={slug} currentUserId={currentUserId} scopes={scopes} members={members} processes={processes} onClose={() => setCreating(false)} /> : null}
      {open ? <VersionsDrawer slug={slug} doc={open} canManage={canManage} members={members} processes={processes} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function TemplatesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Modèles de documents" onClose={onClose}>
      <p className="risk-mut-hint" style={{ marginTop: 0 }}>Téléchargez un modèle prêt à remplir (Word), ou créez un document du type voulu pour l’éditer directement dans Toron.</p>
      <div className="version-list">
        {DOCUMENT_TYPES.map((t) => (
          <div className="version-row" key={t}>
            <span className="grow" style={{ fontSize: 13 }}>{DOCUMENT_TYPE_LABEL[t]}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => exportDocx(`Modèle — ${DOCUMENT_TYPE_LABEL[t]}`, `Modèle de document Toron`, DOCUMENT_TEMPLATES[t].html)}>↓ Word (.doc)</button>
          </div>
        ))}
      </div>
      <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button></div>
    </Dialog>
  );
}

function CreateDialog({ slug, currentUserId, scopes, members, processes, onClose }: { slug: string; currentUserId: string; scopes: ScopeSummary[]; members: TenantMember[]; processes: ProcessOption[]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Le FormData ne porte pas le bouton qui a soumis le formulaire : le choix
  // « Créer » / « Créer et éditer » est retenu au clic.
  const toEditor = useRef(false);
  function submit(fd: FormData) {
    setError(null);
    const openEditor = toEditor.current;
    start(async () => {
      const res = await createDocumentAction(slug, { type: String(fd.get('type') ?? 'autre'), title: String(fd.get('title') ?? ''), scopeId: String(fd.get('scopeId') ?? '') || null, processId: String(fd.get('processId') ?? '') || null, ownerUserId: String(fd.get('ownerUserId') ?? '') || null, reviewDue: String(fd.get('reviewDue') ?? '') || null });
      if (res.ok) {
        onClose();
        // Navigation complète : un retour arrière depuis l'éditeur quitte la page
        // et déclenche l'avertissement sur le texte non enregistré.
        if (openEditor) window.location.assign(`/t/${slug}/documents/editer/${res.data.documentId}`);
        else router.refresh();
      } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Nouveau document" onClose={onClose}>
      <form onSubmit={keepValues(submit)}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="Politique de sécurité…" /></label>
        <div className="risk-form-grid">
          <label className="field">Type<select name="type" defaultValue="politique">{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABEL[t]}</option>)}</select></label>
          <label className="field">Périmètre<select name="scopeId" defaultValue={scopes[0]?.id ?? ''}><option value="">—</option>{scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          {processes.length > 0 ? <label className="field">Processus<select name="processId" defaultValue=""><option value="">— Aucun —</option>{processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : null}
          <label className="field">Propriétaire<select name="ownerUserId" defaultValue={currentUserId}><option value="">— Non attribué —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          <label className="field">Date de revue<input type="date" name="reviewDue" /></label>
        </div>
        <p className="risk-mut-hint" style={{ marginTop: 0 }}>La date de revue apparaît dans « Mon travail » du propriétaire et signale le document une fois dépassée. Elle reste modifiable depuis la fiche.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { toEditor.current = false; }}>Créer</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending} onClick={() => { toEditor.current = true; }}>{pending ? 'Création…' : 'Créer et éditer'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function VersionsDrawer({ slug, doc, canManage, members, processes, onClose }: { slug: string; doc: DocumentSummary; canManage: boolean; members: TenantMember[]; processes: ProcessOption[]; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [versions, setVersions] = useState<DocumentVersionRow[] | null>(null);
  const [nextSemver, setNextSemver] = useState('1.0');
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
      <span className="ds-chip">{DOCUMENT_TYPE_LABEL[doc.type]}</span>
      {doc.reviewOverdue ? <span className="ds-accept-badge pending">REVUE ÉCHUE</span> : null}
    </>
  );

  return (
    <Drawer header={header} labelId="doc-drawer-title" onClose={onClose}>
      {editing ? <DocumentForm key={doc.id} slug={slug} doc={doc} members={members} onDone={() => setEditing(false)} /> : (
        <div className="drawer-section">
          <div className="ds-primary" style={{ fontSize: 14 }}>{doc.title}</div>
          <p className="ds-muted" style={{ marginTop: 4 }}>Propriétaire : {doc.ownerName ?? 'non attribué'} · Prochaine revue : {fmtDate(doc.reviewDue)}{doc.reviewOverdue ? ' — échue' : ''}</p>
          {canManage && doc.reviewOverdue ? <p className="risk-mut-hint" style={{ margin: '4px 0 0' }}>Document relu ? Reportez la date de revue avec « Modifier la fiche ».</p> : null}
          {processes.length > 0 || doc.processId ? (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="ds-muted" style={{ fontSize: 12 }}>Processus :</span>
              {canManage ? (
                <select value={doc.processId ?? ''} disabled={pending} onChange={(e) => reassignProcess(e.target.value || null)} aria-label="Processus" style={{ fontSize: 12, maxWidth: 220 }}>
                  <option value="">— Aucun —</option>
                  {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : <span style={{ fontSize: 12.5 }}>{doc.processName ?? '—'}</span>}
            </div>
          ) : null}
          {canManage ? (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="btn btn-primary btn-sm" href={`/t/${slug}/documents/editer/${doc.id}`}>✎ Ouvrir l’éditeur</a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Modifier la fiche</button>
            </div>
          ) : null}
        </div>
      )}

      <AcknowledgementSection slug={slug} doc={doc} canManage={canManage} />

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
          <p className="drawer-section-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Aperçu du contenu<button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => setViewing(null)}>Fermer</button></p>
          <div className="doc-body-view" dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(viewing.body) }} />
        </div>
      ) : null}

      {canManage ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Téléverser un fichier</p>
          <div className="upload-drop">
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.odt,.txt,.md,.ppt,.pptx,.xls,.xlsx" style={{ display: 'block', marginBottom: 10, maxWidth: '100%' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label className="field" style={{ maxWidth: 110, marginBottom: 0 }}>Version<input ref={semverRef} defaultValue={nextSemver} key={nextSemver} /></label>
              <button className="btn btn-primary btn-sm" disabled={pending} onClick={upload}>{pending ? 'Téléversement…' : 'Téléverser'}</button>
            </div>
            <p className="risk-mut-hint" style={{ margin: '10px 0 0' }}>Ou rédigez directement dans <b>l’éditeur</b> (couleurs, titres, export PDF/Word). Une version publiée devient immuable.</p>
          </div>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}

function DocumentForm({ slug, doc, members, onDone }: { slug: string; doc: DocumentSummary; members: TenantMember[]; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Propriétaire parti de l'organisation : absent de la liste des membres, il
  // reste proposé pour ne pas être désattribué à l'insu du gestionnaire.
  const formerOwner = doc.ownerUserId && !members.some((m) => m.userId === doc.ownerUserId) ? doc.ownerUserId : null;

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await updateDocumentAction(slug, {
        documentId: doc.id,
        title: String(fd.get('title') ?? ''),
        ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
        reviewDue: String(fd.get('reviewDue') ?? '') || null,
      });
      if (res.ok) { router.refresh(); onDone(); } else setError(res.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)} className="drawer-section">
      <p className="drawer-section-label">Fiche du document</p>
      <label className="field">Intitulé<input name="title" required minLength={2} maxLength={200} defaultValue={doc.title} /></label>
      <div className="risk-form-grid">
        <label className="field">Propriétaire
          <select name="ownerUserId" defaultValue={doc.ownerUserId ?? ''}><option value="">— Non attribué —</option>{formerOwner ? <option value={formerOwner}>{doc.ownerName ?? 'Propriétaire actuel'} (ancien membre)</option> : null}{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
        </label>
        <label className="field">Date de revue<input type="date" name="reviewDue" defaultValue={doc.reviewDue?.slice(0, 10) ?? ''} /></label>
      </div>
      <p className="risk-mut-hint" style={{ marginTop: 0 }}>Une fois le document relu, reportez la date de revue : l’alerte « revue échue » disparaît.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </form>
  );
}

function AcknowledgementSection({ slug, doc, canManage }: { slug: string; doc: DocumentSummary; canManage: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<AcknowledgementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reload = () => getAcknowledgementsAction(slug, { documentId: doc.id }).then((res) => { if (res.ok) setView(res.data); });
  useEffect(() => {
    let alive = true;
    getAcknowledgementsAction(slug, { documentId: doc.id }).then((res) => { if (alive && res.ok) setView(res.data); });
    return () => { alive = false; };
  }, [slug, doc.id]);

  if (!view) return null;
  if (!view.required && !canManage) return null;

  function toggle(required: boolean) {
    setError(null);
    start(async () => {
      const res = await setAcknowledgementRequiredAction(slug, { documentId: doc.id, required });
      if (res.ok) { await reload(); router.refresh(); } else setError(res.error.message);
    });
  }
  function acknowledge() {
    setError(null);
    start(async () => {
      const res = await acknowledgeDocumentAction(slug, { documentId: doc.id });
      if (res.ok) { await reload(); router.refresh(); } else setError(res.error.message);
    });
  }

  const progress = acknowledgementProgress(view.acknowledged, view.total);
  const missing = view.members?.filter((m) => !m.acknowledgedAt) ?? [];

  return (
    <div className="drawer-section ack-section">
      <p className="drawer-section-label">Lecture obligatoire</p>
      {canManage ? (
        <label className="ack-toggle">
          <input type="checkbox" checked={view.required} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
          Exiger que chaque membre lise et accepte la version publiée
        </label>
      ) : null}
      {view.required ? (
        view.semver ? (
          <>
            <div className="ack-progress">
              <span className="coverage-bar" aria-hidden="true"><span style={{ width: `${progress.pct ?? 0}%` }} /></span>
              <span className="ds-muted">
                {progress.acknowledged === 0
                  ? `Aucun membre n’a encore accepté la v${view.semver}`
                  : `${progress.acknowledged} membre${progress.acknowledged > 1 ? 's' : ''} sur ${progress.total} ${progress.acknowledged > 1 ? 'ont' : 'a'} accepté la v${view.semver}`}
              </span>
            </div>
            {view.acknowledgedByMe ? (
              <p className="ack-done">Vous avez accepté la v{view.semver} le {new Date(view.acknowledgedByMe).toLocaleDateString('fr-FR')}.</p>
            ) : (
              <button className="btn btn-primary btn-sm" disabled={pending} onClick={acknowledge}>
                {pending ? 'Enregistrement…' : `J’ai lu et j’accepte la version ${view.semver}`}
              </button>
            )}
            {canManage && missing.length > 0 ? (
              <p className="ds-muted ack-missing">En attente : {missing.map((m) => m.name).join(', ')}</p>
            ) : null}
          </>
        ) : (
          <p className="ds-muted">Publiez une version pour lancer la campagne de lecture : chaque membre la retrouvera dans « Mon travail ».</p>
        )
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
