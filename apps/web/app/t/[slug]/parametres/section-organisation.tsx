'use client';

import type { LegalEntityRow, OrganisationProfile, SiteRow } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteEntityAction, deleteSiteAction, saveEntityAction, saveSiteAction, updateOrganisationAction } from './actions';
import type { Viewer } from './parametres-client';

export function SectionOrganisation({ slug, viewer, profile, entities, sites }: {
  slug: string; viewer: Viewer; profile: OrganisationProfile; entities: LegalEntityRow[]; sites: SiteRow[];
}) {
  return (
    <>
      <ProfileCard slug={slug} viewer={viewer} profile={profile} />
      <EntitiesCard slug={slug} viewer={viewer} entities={entities} />
      <SitesCard slug={slug} viewer={viewer} entities={entities} sites={sites} />
    </>
  );
}

function ProfileCard({ slug, viewer, profile }: { slug: string; viewer: Viewer; profile: OrganisationProfile }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null); setSaved(false);
    start(async () => {
      const res = await updateOrganisationAction(slug, {
        name: String(fd.get('name') ?? ''), sector: String(fd.get('sector') ?? ''), employeeCount: String(fd.get('employeeCount') ?? ''),
      });
      if (res.ok) { setSaved(true); router.refresh(); } else setError(res.error.message);
    });
  }

  return (
    <article className="card settings-card">
      <div className="settings-card-head">
        <div>
          <h2>Profil de l’organisation</h2>
          <p className="hint">
            Le nom apparaît dans la navigation et sur chaque livrable scellé. L’effectif et le
            secteur situent votre organisation vis-à-vis de NIS 2 et dimensionnent les revues.
          </p>
        </div>
        <span className="ds-mono">/t/{profile.slug}</span>
      </div>
      <form action={submit}>
        <div className="settings-grid">
          <label className="field">Nom de l’organisation
            <input name="name" defaultValue={profile.name} minLength={2} maxLength={160} required disabled={!viewer.canConfigure} />
          </label>
          <label className="field">Secteur d’activité
            <input name="sector" defaultValue={profile.sector ?? ''} maxLength={120} placeholder="Ex. Logistique et transport" disabled={!viewer.canConfigure} />
          </label>
          <label className="field">Effectif (salariés)
            <input name="employeeCount" type="number" min={0} max={100000000} step={1} defaultValue={profile.employeeCount ?? ''} placeholder="Ex. 148" disabled={!viewer.canConfigure} />
          </label>
          <label className="field">Région d’hébergement
            <input value="Union européenne · France" readOnly aria-readonly="true" />
          </label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {viewer.canConfigure ? (
          <div className="settings-actions">
            {saved ? <span className="status" role="status">Profil enregistré.</span> : null}
            <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        ) : (
          <p className="hint">Lecture seule — la configuration est réservée au propriétaire, à la direction, au RSSI et au responsable qualité.</p>
        )}
      </form>
    </article>
  );
}

function EntitiesCard({ slug, viewer, entities }: { slug: string; viewer: Viewer; entities: LegalEntityRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<LegalEntityRow | null | 'new'>(null);
  const [deleting, setDeleting] = useState<LegalEntityRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(entity: LegalEntityRow) {
    setError(null);
    start(async () => {
      const res = await deleteEntityAction(slug, { id: entity.id });
      if (res.ok) { setDeleting(null); router.refresh(); } else setError(res.error.message);
    });
  }

  return (
    <article className="card settings-card">
      <div className="settings-card-head">
        <div>
          <h2>Entités juridiques</h2>
          <p className="hint">Les sociétés couvertes par vos systèmes de management ; les sites et périmètres s’y rattachent.</p>
        </div>
        {viewer.canConfigure ? <button className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>+ Ajouter une entité</button> : null}
      </div>
      {entities.length === 0 ? (
        <p className="ds-empty">Aucune entité enregistrée — ajoutez la société principale pour y rattacher vos sites.</p>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 520 }}>
            <thead><tr><th>Entité</th><th style={{ width: 130 }}>SIREN</th><th style={{ width: 80 }}>Sites</th>{viewer.canConfigure ? <th style={{ width: 170 }} /> : null}</tr></thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id} style={{ cursor: 'default' }}>
                  <td><span className="ds-primary">{e.name}</span></td>
                  <td className="ds-mono">{e.siren ?? '—'}</td>
                  <td className="ds-mono">{e.siteCount}</td>
                  {viewer.canConfigure ? (
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}>Modifier</button>{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => { setError(null); setDeleting(e); }}>Supprimer</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {editing ? <EntityDrawer slug={slug} entity={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Dialog title="Supprimer cette entité ?" onClose={() => setDeleting(null)}>
          <p className="hint">
            <b>{deleting.name}</b> sera retirée de l’organisation.
            {deleting.siteCount > 0 ? ` Elle porte encore ${deleting.siteCount} site${deleting.siteCount > 1 ? 's' : ''} : la suppression sera refusée tant qu’ils y sont rattachés.` : ''}
          </p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>Annuler</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(deleting)} disabled={pending}>{pending ? 'Suppression…' : 'Supprimer'}</button>
          </div>
        </Dialog>
      ) : null}
    </article>
  );
}

function EntityDrawer({ slug, entity, onClose }: { slug: string; entity: LegalEntityRow | null; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await saveEntityAction(slug, { id: entity?.id, name: String(fd.get('name') ?? ''), siren: String(fd.get('siren') ?? '') });
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message);
    });
  }
  return (
    <Drawer header={<><span className="ds-id" id="entity-title">{entity ? 'Entité' : 'Nouvelle entité'}</span><span className="ds-chip">Organisation</span></>} labelId="entity-title" onClose={onClose}>
      <form action={submit}>
        <label className="field">Raison sociale<input name="name" defaultValue={entity?.name ?? ''} minLength={2} maxLength={160} required autoFocus /></label>
        <label className="field">SIREN (facultatif)<input name="siren" defaultValue={entity?.siren ?? ''} inputMode="numeric" pattern="[0-9 ]*" placeholder="9 chiffres" /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : entity ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </Drawer>
  );
}

function SitesCard({ slug, viewer, entities, sites }: { slug: string; viewer: Viewer; entities: LegalEntityRow[]; sites: SiteRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SiteRow | null | 'new'>(null);
  const [deleting, setDeleting] = useState<SiteRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(site: SiteRow) {
    setError(null);
    start(async () => {
      const res = await deleteSiteAction(slug, { id: site.id });
      if (res.ok) { setDeleting(null); router.refresh(); } else setError(res.error.message);
    });
  }

  return (
    <article className="card settings-card">
      <div className="settings-card-head">
        <div>
          <h2>Sites</h2>
          <p className="hint">Lieux physiques (siège, entrepôts, agences) — ils délimitent vos périmètres et vos audits.</p>
        </div>
        {viewer.canConfigure ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing('new')} disabled={entities.length === 0} title={entities.length === 0 ? 'Créez d’abord une entité juridique' : undefined}>+ Ajouter un site</button>
        ) : null}
      </div>
      {sites.length === 0 ? (
        <p className="ds-empty">{entities.length === 0 ? 'Ajoutez d’abord une entité juridique, puis ses sites.' : 'Aucun site enregistré — ajoutez le siège et les sites opérationnels.'}</p>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 560 }}>
            <thead><tr><th>Site</th><th>Entité</th><th>Adresse</th>{viewer.canConfigure ? <th style={{ width: 170 }} /> : null}</tr></thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id} style={{ cursor: 'default' }}>
                  <td><span className="ds-primary">{s.name}</span></td>
                  <td className="ds-muted">{s.entityName}</td>
                  <td className="ds-muted">{s.address ?? '—'}</td>
                  {viewer.canConfigure ? (
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>Modifier</button>{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => { setError(null); setDeleting(s); }}>Supprimer</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {editing ? <SiteDrawer slug={slug} site={editing === 'new' ? null : editing} entities={entities} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Dialog title="Supprimer ce site ?" onClose={() => setDeleting(null)}>
          <p className="hint"><b>{deleting.name}</b> sera retiré de l’organisation et détaché des périmètres qui le mentionnent.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>Annuler</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(deleting)} disabled={pending}>{pending ? 'Suppression…' : 'Supprimer'}</button>
          </div>
        </Dialog>
      ) : null}
    </article>
  );
}

function SiteDrawer({ slug, site, entities, onClose }: { slug: string; site: SiteRow | null; entities: LegalEntityRow[]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await saveSiteAction(slug, { id: site?.id, entityId: String(fd.get('entityId') ?? ''), name: String(fd.get('name') ?? ''), address: String(fd.get('address') ?? '') });
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message);
    });
  }
  return (
    <Drawer header={<><span className="ds-id" id="site-title">{site ? 'Site' : 'Nouveau site'}</span><span className="ds-chip">Organisation</span></>} labelId="site-title" onClose={onClose}>
      <form action={submit}>
        <label className="field">Nom du site<input name="name" defaultValue={site?.name ?? ''} minLength={2} maxLength={160} required autoFocus placeholder="Ex. Entrepôt de Saint-Priest" /></label>
        <label className="field">Entité juridique
          <select name="entityId" defaultValue={site?.entityId ?? entities[0]?.id ?? ''} required>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label className="field">Adresse (facultatif)<textarea name="address" defaultValue={site?.address ?? ''} rows={2} maxLength={300} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : site ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </Drawer>
  );
}
