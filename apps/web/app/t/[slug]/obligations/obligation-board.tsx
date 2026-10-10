'use client';

import {
  NIS2_REGISTRATION_LABEL,
  NIS2_REGISTRATION_STATES,
  NIS2_SECTORS,
  NIS2_STATUS_LABEL,
  OBLIGATION_REGIMES,
  OBLIGATION_REGIME_LABEL,
  OBLIGATION_STATUSES,
  OBLIGATION_STATUS_LABEL,
  nis2Qualification,
  obligationAttention,
  type Nis2Qualification,
  type ObligationRegime,
} from '@toron/core';
import type { EntityNis2, ObligationRow, TenantMember } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { useOpenItem } from '@/lib/use-open-item';

import {
  addSuggestedObligationsAction,
  createObligationAction,
  deleteObligationAction,
  updateEntityNis2Action,
  updateObligationAction,
} from './obligation-actions';

export interface EntityView {
  entity: EntityNis2;
  qualification: Nis2Qualification;
  missingSuggestions: number;
}

function fmt(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

const numOrNull = (v: FormDataEntryValue | null): number | null => {
  const t = String(v ?? '').trim().replace(',', '.');
  return t === '' ? null : Number(t);
};

export function ObligationBoard({ slug, today, canManage, canConfigure, entities, obligations, members, lateCount }: {
  slug: string; today: string; canManage: boolean; canConfigure: boolean; entities: EntityView[];
  obligations: ObligationRow[]; members: TenantMember[]; lateCount: number;
}) {
  const [regime, setRegime] = useState<ObligationRegime | null>(null);
  const [creating, setCreating] = useState(false);
  const [qualifying, setQualifying] = useState<EntityView | null>(null);
  const [openId, setOpenId] = useOpenItem(obligations.map((o) => o.id));
  const editing = obligations.find((o) => o.id === openId) ?? null;

  const regimes = OBLIGATION_REGIMES.filter((r) => obligations.some((o) => o.regime === r));
  const shown = regime ? obligations.filter((o) => o.regime === regime) : obligations;
  const applicable = obligations.filter((o) => o.status !== 'non_applicable');
  const met = applicable.filter((o) => o.status === 'conforme').length;

  return (
    <>
      <section className="obl-entities" aria-label="Qualification NIS 2 des entités">
        {entities.map((v) => (
          <EntityCard key={v.entity.id} slug={slug} view={v} canConfigure={canConfigure} canManage={canManage} onQualify={() => setQualifying(v)} />
        ))}
        {/* Une organisation neuve n'a pas d'entité : sans elle, ni qualification ni suggestions. */}
        {entities.length === 0 ? (
          <article className="obl-entity">
            <div className="obl-entity-head"><h2>Aucune entité juridique enregistrée</h2></div>
            <p className="obl-entity-reason">
              Ajoutez votre société pour obtenir sa qualification NIS 2 et les obligations qui s’appliquent.
              {canConfigure ? null : ' Demandez-le à un administrateur de l’organisation.'}
            </p>
            {canConfigure ? <a className="btn btn-ghost btn-sm" href={`/t/${slug}/parametres?section=organisation`}>Ajouter une entité</a> : null}
          </article>
        ) : null}
      </section>

      <div className="obl-summary">
        <span><b>{met}</b> / {applicable.length} obligations respectées</span>
        <span className="obl-meter" role="img" aria-label={`${met} sur ${applicable.length} obligations respectées`}>
          <span style={{ width: `${applicable.length ? Math.round((met / applicable.length) * 100) : 0}%` }} />
        </span>
        {lateCount > 0 ? <span className="obl-late">{lateCount} échéance{lateCount > 1 ? 's' : ''} dépassée{lateCount > 1 ? 's' : ''}</span> : null}
      </div>

      <div className="ds-toolbar">
        {regimes.length > 1 ? (
          <div className="view-toggle" role="group" aria-label="Filtrer par régime">
            <button type="button" aria-pressed={regime === null} onClick={() => setRegime(null)}>Tous · {obligations.length}</button>
            {regimes.map((r) => (
              <button type="button" key={r} aria-pressed={regime === r} onClick={() => setRegime(r)}>
                {OBLIGATION_REGIME_LABEL[r]} · {obligations.filter((o) => o.regime === r).length}
              </button>
            ))}
          </div>
        ) : <span className="drawer-section-label" style={{ margin: 0 }}>Registre · {obligations.length}</span>}
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouvelle obligation</button> : null}
      </div>

      {obligations.length === 0 ? (
        <div className="empty-state">
          <h2>Registre vide</h2>
          <p>
            {entities.length === 0 ? 'Ajoutez d’abord votre entité juridique' : 'Qualifiez vos entités ci-dessus'} : Toron propose les obligations NIS 2 et RGPD qui
            s’appliquent. Ajoutez ensuite vos exigences sectorielles et contractuelles.
          </p>
        </div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 960 }}>
            <thead><tr>
              <th style={{ width: 74 }}>ID</th><th style={{ minWidth: 340 }}>Obligation</th><th style={{ width: 110 }}>Régime</th>
              <th style={{ width: 130 }}>Statut</th><th style={{ width: 150 }}>Responsable</th><th style={{ width: 110 }}>Échéance</th>
            </tr></thead>
            <tbody>
              {shown.map((o) => {
                const attention = obligationAttention(o.status, o.dueDate, today);
                return (
                  <tr key={o.id} onClick={() => setOpenId(o.id)}>
                    <td className="ds-id">{refCode('OBL', o.id)}</td>
                    <td><div className="ds-primary">{o.title}<small>{[o.source, entities.length > 1 ? o.entityName : null].filter(Boolean).join(' · ') || '—'}</small></div></td>
                    <td><span className="ds-chip">{OBLIGATION_REGIME_LABEL[o.regime]}</span></td>
                    <td><span className={`obl-status obl-status--${o.status}`}>{OBLIGATION_STATUS_LABEL[o.status]}</span></td>
                    <td><div className="ds-owner"><span className="ds-avatar">{initials(o.ownerName)}</span><span>{o.ownerName ?? '—'}</span></div></td>
                    <td className={`ds-mono obl-due--${attention}`}>{fmt(o.dueDate)}{attention === 'en_retard' ? <span className="sr-only"> (dépassée)</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? <ObligationDrawer slug={slug} obligation={null} entities={entities} members={members} canManage={canManage} onClose={() => setCreating(false)} /> : null}
      {editing ? <ObligationDrawer key={editing.id} slug={slug} obligation={editing} entities={entities} members={members} canManage={canManage} onClose={() => setOpenId(null)} /> : null}
      {qualifying ? <EntityDrawer slug={slug} view={qualifying} today={today} onClose={() => setQualifying(null)} /> : null}
    </>
  );
}

function EntityCard({ slug, view, canConfigure, canManage, onQualify }: { slug: string; view: EntityView; canConfigure: boolean; canManage: boolean; onQualify: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { entity, qualification: q } = view;

  function addSuggestions() {
    setMessage(null);
    start(async () => {
      const r = await addSuggestedObligationsAction(slug, entity.id);
      if (r.ok) { setMessage(`${r.data.added} obligation${r.data.added > 1 ? 's' : ''} ajoutée${r.data.added > 1 ? 's' : ''} au registre.`); router.refresh(); } else setMessage(r.error.message);
    });
  }

  return (
    <article className="obl-entity">
      <div className="obl-entity-head">
        <h2>{entity.name}</h2>
        <span className={`nis2-chip nis2-chip--${q.status}`}>{NIS2_STATUS_LABEL[q.status]}</span>
      </div>
      <p className="obl-entity-reason">{q.reason}</p>
      <dl className="obl-entity-meta">
        <div><dt>Enregistrement ANSSI</dt><dd>{NIS2_REGISTRATION_LABEL[entity.registration]}{entity.registeredOn ? ` le ${fmt(entity.registeredOn)}` : ''}{entity.reference ? ` · ${entity.reference}` : ''}</dd></div>
      </dl>
      {view.missingSuggestions > 0 ? (
        <p className="obl-suggest">
          {view.missingSuggestions} obligation{view.missingSuggestions > 1 ? 's' : ''} suggérée{view.missingSuggestions > 1 ? 's' : ''} pour cette qualification
          {canManage ? <button type="button" className="btn btn-ghost btn-sm" onClick={addSuggestions} disabled={pending}>{pending ? 'Ajout…' : 'Ajouter au registre'}</button> : null}
        </p>
      ) : null}
      {message ? <p className="obl-entity-msg" role="status">{message}</p> : null}
      {canConfigure ? <button type="button" className="btn btn-ghost btn-sm" onClick={onQualify}>{q.status === 'indeterminee' ? 'Qualifier l’entité' : 'Modifier la qualification'}</button> : null}
    </article>
  );
}

function EntityDrawer({ slug, view, today, onClose }: { slug: string; view: EntityView; today: string; onClose: () => void }) {
  const router = useRouter();
  const e = view.entity;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ sector: e.sector ?? '', employees: e.employees?.toString() ?? '', turnover: e.turnoverMeur?.toString() ?? '', balance: e.balanceSheetMeur?.toString() ?? '' });
  const [override, setOverride] = useState<string>(e.override ?? '');
  // Résultat des seuls critères, affiché pendant la saisie.
  const computed = nis2Qualification({
    sector: draft.sector || null, employees: numOrNull(draft.employees), turnoverMeur: numOrNull(draft.turnover),
    balanceSheetMeur: numOrNull(draft.balance), override: null,
  });

  function submit(fd: FormData) {
    setError(null);
    const nums = [numOrNull(fd.get('employees')), numOrNull(fd.get('turnover')), numOrNull(fd.get('balance'))];
    if (nums.some((n) => n !== null && Number.isNaN(n))) { setError('Effectif, chiffre d’affaires et bilan doivent être des nombres.'); return; }
    start(async () => {
      const r = await updateEntityNis2Action(slug, {
        entityId: e.id,
        sector: String(fd.get('sector') ?? '') || null,
        employees: nums[0],
        turnoverMeur: nums[1],
        balanceSheetMeur: nums[2],
        override: String(fd.get('override') ?? '') || null,
        overrideReason: String(fd.get('overrideReason') ?? '') || null,
        registration: String(fd.get('registration') ?? 'a_faire'),
        registeredOn: String(fd.get('registeredOn') ?? '') || null,
        reference: String(fd.get('reference') ?? '') || null,
      });
      if (r.ok) { onClose(); router.refresh(); } else setError(r.error.message);
    });
  }

  const header = <><span className="ds-id" id="ent-title">{e.name}</span><span className="ds-chip">Qualification NIS 2</span></>;
  return (
    <Drawer header={header} labelId="ent-title" onClose={onClose}>
      <form onSubmit={keepValues(submit)}>
        <label className="field">Secteur d’activité
          <select name="sector" value={draft.sector} onChange={(ev) => setDraft({ ...draft, sector: ev.target.value })}>
            <option value="">— Choisir —</option>
            <optgroup label="Annexe I — secteurs hautement critiques">{NIS2_SECTORS.filter((s) => s.annex === 1).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
            <optgroup label="Annexe II — autres secteurs critiques">{NIS2_SECTORS.filter((s) => s.annex === 2).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
            <option value="hors_champ">Aucun de ces secteurs</option>
          </select>
        </label>
        <div className="risk-form-grid">
          <label className="field">Effectif<input name="employees" inputMode="numeric" value={draft.employees} onChange={(ev) => setDraft({ ...draft, employees: ev.target.value })} /></label>
          <label className="field">Chiffre d’affaires (M€)<input name="turnover" inputMode="decimal" value={draft.turnover} onChange={(ev) => setDraft({ ...draft, turnover: ev.target.value })} /></label>
          <label className="field">Total du bilan (M€)<input name="balance" inputMode="decimal" value={draft.balance} onChange={(ev) => setDraft({ ...draft, balance: ev.target.value })} /></label>
        </div>
        <div className="obl-preview" aria-live="polite">
          <span className={`nis2-chip nis2-chip--${computed.status}`}>{NIS2_STATUS_LABEL[computed.status]}</span>
          <span>{computed.reason}</span>
        </div>
        <label className="field">Qualification retenue
          <select name="override" value={override} onChange={(ev) => setOverride(ev.target.value)}>
            <option value="">Celle du calcul</option>
            <option value="ee">Entité essentielle (désignation, cas particulier)</option>
            <option value="ei">Entité importante (désignation, cas particulier)</option>
            <option value="non_concernee">Non concernée</option>
          </select>
        </label>
        {override ? <label className="field">Justification<textarea name="overrideReason" rows={2} required defaultValue={e.overrideReason ?? ''} placeholder="Désignation notifiée par l’ANSSI le…, prestataire de confiance qualifié…" /></label> : null}
        <p className="drawer-section-label">Enregistrement auprès de l’ANSSI (MonEspaceNIS2)</p>
        <div className="risk-form-grid">
          <label className="field">État<select name="registration" defaultValue={e.registration}>{NIS2_REGISTRATION_STATES.map((s) => <option key={s} value={s}>{NIS2_REGISTRATION_LABEL[s]}</option>)}</select></label>
          <label className="field">Enregistrée le<input type="date" name="registeredOn" max={today} defaultValue={e.registeredOn ?? ''} /></label>
          <label className="field field--full">Référence du dossier<input name="reference" maxLength={120} defaultValue={e.reference ?? ''} /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </Drawer>
  );
}

function ObligationDrawer({ slug, obligation, entities, members, canManage, onClose }: { slug: string; obligation: ObligationRow | null; entities: EntityView[]; members: TenantMember[]; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const isEdit = obligation !== null;
  const [status, setStatus] = useState<string>(obligation?.status ?? 'a_evaluer');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    const payload = {
      entityId: String(fd.get('entityId') ?? '') || null,
      regime: String(fd.get('regime') ?? 'autre'),
      title: String(fd.get('title') ?? ''),
      source: String(fd.get('source') ?? '') || null,
      description: String(fd.get('description') ?? '') || null,
      ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
      status,
      justification: String(fd.get('justification') ?? '') || null,
      dueDate: String(fd.get('dueDate') ?? '') || null,
    };
    start(async () => {
      const r = isEdit ? await updateObligationAction(slug, { obligationId: obligation!.id, ...payload }) : await createObligationAction(slug, payload);
      if (r.ok) { onClose(); router.refresh(); } else setError(r.error.message);
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const r = await deleteObligationAction(slug, obligation!.id);
      if (r.ok) { onClose(); router.refresh(); } else setError(r.error.message);
    });
  }

  const header = <><span className="ds-id" id="obl-title">{isEdit ? refCode('OBL', obligation!.id) : 'Nouvelle'}</span><span className="ds-chip">Obligation</span></>;
  return (
    <Drawer header={header} labelId="obl-title" onClose={onClose}>
      <form onSubmit={keepValues(submit)}>
        <label className="field">Intitulé<textarea name="title" rows={2} required minLength={2} maxLength={300} defaultValue={obligation?.title ?? ''} disabled={!canManage} /></label>
        <div className="risk-form-grid">
          <label className="field">Régime<select name="regime" defaultValue={obligation?.regime ?? 'sectoriel'} disabled={!canManage}>{OBLIGATION_REGIMES.map((r) => <option key={r} value={r}>{OBLIGATION_REGIME_LABEL[r]}</option>)}</select></label>
          <label className="field">Entité<select name="entityId" defaultValue={obligation?.entityId ?? entities[0]?.entity.id ?? ''} disabled={!canManage}><option value="">Toute l’organisation</option>{entities.map((v) => <option key={v.entity.id} value={v.entity.id}>{v.entity.name}</option>)}</select></label>
          <label className="field field--full">Source (texte, article, contrat)<input name="source" maxLength={300} defaultValue={obligation?.source ?? ''} placeholder="Code des transports, art. … ; contrat client, annexe sécurité…" disabled={!canManage} /></label>
          <label className="field">Statut<select name="status" value={status} onChange={(ev) => setStatus(ev.target.value)} disabled={!canManage}>{OBLIGATION_STATUSES.map((s) => <option key={s} value={s}>{OBLIGATION_STATUS_LABEL[s]}</option>)}</select></label>
          <label className="field">Échéance<input type="date" name="dueDate" defaultValue={obligation?.dueDate ?? ''} disabled={!canManage} /></label>
          <label className="field field--full">Responsable<select name="ownerUserId" defaultValue={obligation?.ownerUserId ?? ''} disabled={!canManage}><option value="">— Non attribuée —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
        </div>
        {status === 'non_applicable' ? (
          <label className="field">Pourquoi ne s’applique-t-elle pas ?<textarea name="justification" rows={3} required maxLength={2000} defaultValue={obligation?.justification ?? ''} disabled={!canManage} /></label>
        ) : null}
        <label className="field">Notes de mise en œuvre<textarea name="description" rows={3} maxLength={4000} defaultValue={obligation?.description ?? ''} disabled={!canManage} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {canManage ? (
          <div className="dialog-actions">
            {isEdit && !confirming ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>Supprimer</button> : null}
            {confirming ? <><span className="obl-confirm">Supprimer définitivement ?</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Annuler</button><button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={pending}>Supprimer</button></> : null}
            <span className="spacer" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'}</button>
          </div>
        ) : null}
      </form>
    </Drawer>
  );
}
