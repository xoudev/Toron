'use client';

import type { DocumentSummary, DocumentVersionRow, ScopeSummary, TenantMember } from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  addVersionAction,
  createDocumentAction,
  getVersionsAction,
  publishVersionAction,
} from './document-actions';

const TYPE_LABEL: Record<string, string> = {
  pssi: 'PSSI',
  politique: 'Politique',
  procedure: 'Procédure',
  charte: 'Charte',
  pca_pra: 'PCA / PRA',
  fiche_processus: 'Fiche processus',
  autre: 'Autre',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function DocumentsBoard({
  slug,
  canManage,
  documents,
  scopes,
  members,
}: {
  slug: string;
  canManage: boolean;
  documents: DocumentSummary[];
  scopes: ScopeSummary[];
  members: TenantMember[];
}) {
  const [creating, setCreating] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocumentSummary | null>(null);

  return (
    <>
      {canManage ? (
        <div className="plan-toolbar">
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouveau document</button>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <div className="empty-state"><h2>Aucun document</h2><p>Créez un document et téléversez sa première version.</p></div>
      ) : (
        <div className="doc-grid">
          {documents.map((d) => (
            <article className="card doc-card" key={d.id}>
              <div className="doc-card-head">
                <div>
                  <div className="doc-title">{d.title}</div>
                  <div className="doc-type">{TYPE_LABEL[d.type] ?? d.type}</div>
                </div>
                {d.latestStatus ? (
                  <span className={`doc-status doc-status--${d.latestStatus}`}>
                    {d.latestStatus === 'publie' ? 'Publié' : 'Brouillon'}
                  </span>
                ) : null}
              </div>
              <div className="doc-meta">
                {d.latestSemver ? <span className="doc-version-badge">v{d.latestSemver}</span> : <span className="review-chip">Aucune version</span>}
                <span>{d.ownerName ?? '—'}</span>
                <span className={`review-chip${d.reviewOverdue ? ' late' : ''}`}>
                  Revue&nbsp;: {fmtDate(d.reviewDue)}{d.reviewOverdue ? ' — dépassée' : ''}
                </span>
              </div>
              <div className="doc-card-foot">
                <button className="btn btn-ghost btn-sm" onClick={() => setOpenDoc(d)}>
                  Versions ({d.versionCount})
                </button>
                {d.requirementCount > 0 ? (
                  <span className="review-chip">{d.requirementCount} exigence{d.requirementCount > 1 ? 's' : ''} couverte{d.requirementCount > 1 ? 's' : ''}</span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {creating ? (
        <CreateDialog slug={slug} scopes={scopes} members={members} onClose={() => setCreating(false)} />
      ) : null}
      {openDoc ? (
        <VersionsDialog slug={slug} doc={openDoc} canManage={canManage} onClose={() => setOpenDoc(null)} />
      ) : null}
    </>
  );
}

function CreateDialog({
  slug,
  scopes,
  members,
  onClose,
}: {
  slug: string;
  scopes: ScopeSummary[];
  members: TenantMember[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createDocumentAction(slug, {
        type: String(fd.get('type') ?? 'autre'),
        title: String(fd.get('title') ?? ''),
        scopeId: String(fd.get('scopeId') ?? '') || null,
        ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
        reviewDue: String(fd.get('reviewDue') ?? '') || null,
      });
      if (res.ok) {
        onClose();
        router.refresh();
      } else setError(res.error.message);
    });
  }

  return (
    <Dialog title="Nouveau document" onClose={onClose}>
      <form action={submit}>
        <label className="field">
          Intitulé
          <input name="title" minLength={2} required placeholder="Politique de sécurité…" />
        </label>
        <div className="risk-form-grid">
          <label className="field">
            Type
            <select name="type" defaultValue="politique">
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            Périmètre
            <select name="scopeId" defaultValue={scopes[0]?.id ?? ''}>
              <option value="">—</option>
              {scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field">
            Propriétaire
            <select name="ownerUserId" defaultValue="">
              <option value="">— Non attribué —</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </select>
          </label>
          <label className="field">
            Date de revue
            <input type="date" name="reviewDue" />
          </label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            {pending ? 'Création…' : 'Créer'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function VersionsDialog({
  slug,
  doc,
  canManage,
  onClose,
}: {
  slug: string;
  doc: DocumentSummary;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [versions, setVersions] = useState<DocumentVersionRow[] | null>(null);
  const [nextSemver, setNextSemver] = useState('1.0');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const semverRef = useRef<HTMLInputElement>(null);

  const reload = () =>
    getVersionsAction(slug, { documentId: doc.id }).then((res) => {
      if (res.ok) {
        setVersions(res.data.versions);
        setNextSemver(res.data.nextSemver);
      }
    });

  useEffect(() => {
    let alive = true;
    getVersionsAction(slug, { documentId: doc.id }).then((res) => {
      if (alive && res.ok) {
        setVersions(res.data.versions);
        setNextSemver(res.data.nextSemver);
      }
    });
    return () => {
      alive = false;
    };
  }, [slug, doc.id]);

  function upload() {
    setError(null);
    const file = fileRef.current?.files?.[0];
    const semver = semverRef.current?.value ?? nextSemver;
    if (!file) {
      setError('Choisissez un fichier.');
      return;
    }
    const fd = new FormData();
    fd.set('documentId', doc.id);
    fd.set('semver', semver);
    fd.set('file', file);
    start(async () => {
      const res = await addVersionAction(slug, fd);
      if (res.ok) {
        if (fileRef.current) fileRef.current.value = '';
        await reload();
        router.refresh();
      } else setError(res.error.message);
    });
  }

  function publish(versionId: string) {
    setError(null);
    start(async () => {
      const res = await publishVersionAction(slug, { versionId });
      if (res.ok) {
        await reload();
        router.refresh();
      } else setError(res.error.message);
    });
  }

  return (
    <Dialog title={doc.title} onClose={onClose}>
      <p className="rating-block-title">Versions</p>
      {versions === null ? (
        <p className="risk-mut-hint">Chargement…</p>
      ) : versions.length === 0 ? (
        <p className="risk-mut-hint">Aucune version — téléversez la première.</p>
      ) : (
        <div className="version-list">
          {versions.map((v) => (
            <div className="version-row" key={v.id}>
              <span className="version-sem">v{v.semver}</span>
              <span className={`doc-status doc-status--${v.status}`}>{v.status === 'publie' ? 'Publié' : 'Brouillon'}</span>
              <span className="grow version-author">{v.createdByName ?? '—'} · {new Date(v.createdAt).toLocaleDateString('fr-FR')}</span>
              {v.hasContent ? (
                <a className="link-btn" href={`/t/${slug}/documents/${v.id}`}>Télécharger</a>
              ) : null}
              {canManage && v.status === 'brouillon' ? (
                <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => publish(v.id)}>Publier</button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="upload-drop" style={{ marginTop: 12 }}>
          <p className="rating-block-title" style={{ margin: 0 }}>Nouvelle version</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="field" style={{ maxWidth: 110 }}>
              Version
              <input ref={semverRef} defaultValue={nextSemver} key={nextSemver} />
            </label>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.odt,.txt,.md,.ppt,.pptx,.xls,.xlsx" />
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={upload}>
              {pending ? 'Téléversement…' : 'Téléverser'}
            </button>
          </div>
          <p className="risk-mut-hint" style={{ margin: 0 }}>Une version publiée devient immuable — créez-en une nouvelle pour toute modification.</p>
        </div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>
      </div>
    </Dialog>
  );
}
