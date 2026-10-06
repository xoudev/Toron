'use client';

import { SCOPE_KINDS, SCOPE_KIND_LABEL, SCOPE_KIND_SHORT, type ScopeKind } from '@toron/core';
import type { LegalEntityRow, ScopeDetail, SiteRow } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteScopeAction, saveScopeAction } from './actions';
import type { Viewer } from './parametres-client';

export function SectionPerimetres({ slug, viewer, scopes, entities, sites }: {
  slug: string; viewer: Viewer; scopes: ScopeDetail[]; entities: LegalEntityRow[]; sites: SiteRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ScopeDetail | null | 'new'>(null);
  const [deleting, setDeleting] = useState<ScopeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const siteName = new Map(sites.map((s) => [s.id, s.name]));

  function remove(scope: ScopeDetail) {
    setError(null);
    start(async () => {
      const res = await deleteScopeAction(slug, { id: scope.id });
      if (res.ok) { setDeleting(null); router.refresh(); } else setError(res.error.message);
    });
  }

  return (
    <>
      <article className="card settings-card">
        <div className="settings-card-head">
          <div>
            <h2>Périmètres de management</h2>
            <p className="hint">
              Un périmètre délimite ce que couvre un système de management : quelles entités, quels
              sites, pour la sécurité de l’information (SMSI), la qualité (QMS) ou les deux. Les
              référentiels s’activent par périmètre ; risques, campagnes et audits s’y rattachent.
            </p>
          </div>
          {viewer.canConfigure ? <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ Nouveau périmètre</button> : null}
        </div>
        {scopes.length === 0 ? (
          <p className="ds-empty">Aucun périmètre — créez-en un pour pouvoir activer un référentiel.</p>
        ) : (
          <div className="scope-grid">
            {scopes.map((s) => (
              <article className="card scope-card" key={s.id}>
                <div className="settings-card-head">
                  <div>
                    <div className="scope-card-title">{s.name}</div>
                    <div className="scope-card-meta">{SCOPE_KIND_LABEL[s.kind]}</div>
                  </div>
                  <span className="ds-chip accent">{SCOPE_KIND_SHORT[s.kind]}</span>
                </div>
                <dl className="settings-kv">
                  <dt>Référentiels actifs</dt><dd className="mono">{s.frameworkCount}</dd>
                  <dt>Risques</dt><dd className="mono">{s.riskCount}</dd>
                  <dt>Entités</dt>
                  <dd>{s.entityIds.length === 0 ? <span className="ds-muted">Toutes</span> : s.entityIds.map((id) => entityName.get(id) ?? '—').join(', ')}</dd>
                  <dt>Sites</dt>
                  <dd>{s.siteIds.length === 0 ? <span className="ds-muted">Tous</span> : s.siteIds.map((id) => siteName.get(id) ?? '—').join(', ')}</dd>
                </dl>
                <div className="scope-card-foot">
                  <a className="btn btn-ghost btn-sm" href={`/t/${slug}/referentiels`}>Référentiels</a>
                  {viewer.canConfigure ? (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>Modifier</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setError(null); setDeleting(s); }}>Supprimer</button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </article>

      {editing ? <ScopeDrawer slug={slug} scope={editing === 'new' ? null : editing} entities={entities} sites={sites} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Dialog title="Supprimer ce périmètre ?" onClose={() => setDeleting(null)}>
          <p className="hint">
            <b>{deleting.name}</b> sera retiré. Un périmètre qui porte des risques, des campagnes
            d’évaluation, des documents, des actifs, des audits ou des études EBIOS RM ne peut pas être
            supprimé : la suppression vous indiquera ce qui le retient.
          </p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>Annuler</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(deleting)} disabled={pending}>{pending ? 'Suppression…' : 'Supprimer'}</button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function ScopeDrawer({ slug, scope, entities, sites, onClose }: {
  slug: string; scope: ScopeDetail | null; entities: LegalEntityRow[]; sites: SiteRow[]; onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await saveScopeAction(slug, {
        id: scope?.id, name: String(fd.get('name') ?? ''), kind: String(fd.get('kind') ?? '') as ScopeKind,
        entityIds: fd.getAll('entityIds').map(String), siteIds: fd.getAll('siteIds').map(String),
      });
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message);
    });
  }

  return (
    <Drawer header={<><span className="ds-id" id="scope-title">{scope ? 'Périmètre' : 'Nouveau périmètre'}</span><span className="ds-chip">Système de management</span></>} labelId="scope-title" onClose={onClose}>
      <form action={submit}>
        <label className="field">Nom du périmètre<input name="name" defaultValue={scope?.name ?? ''} minLength={2} maxLength={160} required autoFocus placeholder="Ex. SMSI — activités logistiques" /></label>
        <label className="field">Nature
          <select name="kind" defaultValue={scope?.kind ?? 'mixte'} required>
            {SCOPE_KINDS.map((k) => <option key={k} value={k}>{SCOPE_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <div className="drawer-section">
          <p className="drawer-section-label">Entités couvertes</p>
          {entities.length === 0 ? <p className="ds-muted">Aucune entité enregistrée : le périmètre couvre toute l’organisation.</p> : (
            <div className="check-list">
              {entities.map((e) => (
                <label key={e.id}><input type="checkbox" name="entityIds" value={e.id} defaultChecked={scope?.entityIds.includes(e.id) ?? false} />{e.name}</label>
              ))}
            </div>
          )}
          <p className="ds-muted" style={{ marginTop: 6 }}>Aucune case cochée = toutes les entités.</p>
        </div>
        <div className="drawer-section">
          <p className="drawer-section-label">Sites couverts</p>
          {sites.length === 0 ? <p className="ds-muted">Aucun site enregistré : le périmètre couvre tous les lieux.</p> : (
            <div className="check-list">
              {sites.map((s) => (
                <label key={s.id}><input type="checkbox" name="siteIds" value={s.id} defaultChecked={scope?.siteIds.includes(s.id) ?? false} />{s.name}</label>
              ))}
            </div>
          )}
          <p className="ds-muted" style={{ marginTop: 6 }}>Aucune case cochée = tous les sites.</p>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : scope ? 'Enregistrer' : 'Créer le périmètre'}</button>
        </div>
      </form>
    </Drawer>
  );
}
