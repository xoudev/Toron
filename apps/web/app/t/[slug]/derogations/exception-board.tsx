'use client';

import {
  EXCEPTION_MAX_MONTHS,
  EXCEPTION_STATE_LABEL,
  canDecideExceptions,
  canRequestException,
  daysUntil,
  defaultExceptionWindow,
  exceptionCloseVerdict,
  exceptionDecisionVerdict,
  exceptionEditVerdict,
  exceptionRenewalVerdict,
  maxExceptionExpiry,
  renewalWindow,
  type ExceptionState,
  type MembershipRole,
} from '@toron/core';
import type { ExceptionRow, TenantMember } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { useOpenItem } from '@/lib/use-open-item';

import { closeExceptionAction, decideExceptionAction, requestExceptionAction, updateExceptionAction } from './exception-actions';

type Lite = { id: string; label: string };

function fmt(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

function fmtInstant(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—';
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Ce qui reste à courir, en clair. */
function remaining(e: ExceptionRow, today: string): string | null {
  if (e.state === 'a_venir') return `Commence le ${fmt(e.startsOn)}`;
  if (e.state === 'en_vigueur' || e.state === 'a_echeance') {
    const days = daysUntil(e.expiresOn, today);
    return days === 0 ? 'Dernier jour aujourd’hui' : `${plural(days, 'jour')} restant${days > 1 ? 's' : ''}`;
  }
  if (e.state === 'echue') return `Échue depuis ${plural(-daysUntil(e.expiresOn, today), 'jour')}`;
  return null;
}

// Ordre d'affichage : ce qui demande une action d'abord.
const STATE_RANK: Record<ExceptionState, number> = {
  en_attente: 0, echue: 1, a_echeance: 2, en_vigueur: 3, a_venir: 4, renouvelee: 5, refusee: 6, cloturee: 7,
};

type View = 'toutes' | 'a_trancher' | 'en_vigueur' | 'a_echeance' | 'echues' | 'closes';
const VIEWS: { key: View; label: string; match: (s: ExceptionState) => boolean }[] = [
  { key: 'toutes', label: 'Toutes', match: () => true },
  { key: 'a_trancher', label: 'À trancher', match: (s) => s === 'en_attente' },
  { key: 'en_vigueur', label: 'En vigueur', match: (s) => s === 'en_vigueur' || s === 'a_echeance' || s === 'a_venir' },
  { key: 'a_echeance', label: 'Échéance proche', match: (s) => s === 'a_echeance' },
  { key: 'echues', label: 'Échues', match: (s) => s === 'echue' },
  { key: 'closes', label: 'Closes', match: (s) => s === 'refusee' || s === 'cloturee' || s === 'renouvelee' },
];

export function ExceptionBoard({ slug, today, role, userId, exceptions, members, controls, assets }: {
  slug: string; today: string; role: MembershipRole; userId: string; exceptions: ExceptionRow[];
  members: TenantMember[]; controls: Lite[]; assets: Lite[];
}) {
  const [view, setView] = useState<View>('toutes');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useOpenItem(exceptions.map((e) => e.id));
  const open = exceptions.find((e) => e.id === openId) ?? null;
  const canRequest = canRequestException(role);

  const sorted = [...exceptions].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.expiresOn.localeCompare(b.expiresOn));
  const current = VIEWS.find((v) => v.key === view)!;
  const shown = sorted.filter((e) => current.match(e.state));

  return (
    <>
      <div className="ds-toolbar">
        <div className="view-toggle" role="group" aria-label="Filtrer les dérogations">
          {VIEWS.map((v) => {
            const n = exceptions.filter((e) => v.match(e.state)).length;
            if (v.key !== 'toutes' && n === 0) return null;
            return <button type="button" key={v.key} aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.label} · {n}</button>;
          })}
        </div>
        <span className="spacer" />
        {canRequest ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Demander une dérogation</button> : null}
      </div>

      {exceptions.length === 0 ? (
        <div className="empty-state">
          <h2>Aucune dérogation</h2>
          <p>
            Quand une règle ne peut pas être appliquée — un équipement qui n’accepte pas l’antivirus, un prestataire sans
            second facteur — consignez l’écart ici : justification, mesures compensatoires, échéance, et la décision d’un tiers.
          </p>
        </div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 980 }}>
            <thead><tr>
              <th style={{ width: 80 }}>ID</th><th style={{ minWidth: 320 }}>Dérogation</th><th style={{ width: 210 }}>Périmètre</th>
              <th style={{ width: 160 }}>Responsable</th><th style={{ width: 170 }}>Validité</th><th style={{ width: 150 }}>État</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={6} className="ds-empty">Aucune dérogation dans cette vue.</td></tr>
              ) : shown.map((e) => (
                <tr key={e.id} onClick={() => setOpenId(e.id)}>
                  <td className="ds-id">{refCode('DRG', e.id)}</td>
                  <td><div className="ds-primary">{e.title}<small>{e.rule}</small></div></td>
                  <td>
                    <div className="drg-scope">
                      {e.controlTitle ? <span className="ds-chip" title="Contrôle concerné">{e.controlTitle}</span> : null}
                      {e.assetName ? <span className="ds-chip" title="Actif concerné">{e.assetName}</span> : null}
                      {!e.controlTitle && !e.assetName ? <span className="ds-muted">—</span> : null}
                    </div>
                  </td>
                  <td><div className="ds-owner"><span className="ds-avatar">{initials(e.ownerName)}</span><span>{e.ownerName ?? '—'}</span></div></td>
                  <td>
                    <span className="ds-mono">{fmt(e.startsOn)} → {fmt(e.expiresOn)}</span>
                    {remaining(e, today) ? <small className={`drg-remaining drg-remaining--${e.state}`}>{remaining(e, today)}</small> : null}
                  </td>
                  <td><span className={`drg-state drg-state--${e.state}`}>{EXCEPTION_STATE_LABEL[e.state]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? (
        <Drawer header={<><span className="ds-id" id="drg-new-title">Nouvelle demande</span><span className="ds-chip">Dérogation</span></>} labelId="drg-new-title" onClose={() => setCreating(false)}>
          <ExceptionForm
            slug={slug} mode="create" today={today} userId={userId} members={members} controls={controls} assets={assets}
            onDone={(id) => { setCreating(false); setOpenId(id); }} onCancel={() => setCreating(false)}
          />
        </Drawer>
      ) : null}
      {open ? (
        <ExceptionDrawer
          key={open.id} slug={slug} today={today} role={role} userId={userId} exception={open} all={exceptions}
          members={members} controls={controls} assets={assets} onOpen={setOpenId} onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

// ── Tiroir d'une dérogation ─────────────────────────────────────────────
function ExceptionDrawer({ slug, today, role, userId, exception: e, all, members, controls, assets, onOpen, onClose }: {
  slug: string; today: string; role: MembershipRole; userId: string; exception: ExceptionRow; all: ExceptionRow[];
  members: TenantMember[]; controls: Lite[]; assets: Lite[]; onOpen: (id: string) => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'renew'>('view');
  const actor = { role, actorUserId: userId };
  const decision = exceptionDecisionVerdict(actor, e);
  const canEdit = exceptionEditVerdict(actor, e).ok;
  const canClose = exceptionCloseVerdict(actor, e).ok;
  const canRenew = exceptionRenewalVerdict(actor, e).ok && e.state !== 'a_venir';
  const origin = e.renewedFromId ? all.find((x) => x.id === e.renewedFromId) ?? null : null;
  const renewal = e.renewalId ? all.find((x) => x.id === e.renewalId) ?? null : null;
  const remain = remaining(e, today);

  const header = (
    <>
      <span className="ds-id" id="drg-title">{refCode('DRG', e.id)}</span>
      <span className={`drg-state drg-state--${e.state}`}>{EXCEPTION_STATE_LABEL[e.state]}</span>
    </>
  );

  if (mode === 'edit' || mode === 'renew') {
    const win = mode === 'renew' ? renewalWindow(e.expiresOn, today) : { startsOn: e.startsOn, expiresOn: e.expiresOn };
    return (
      <Drawer header={header} labelId="drg-title" onClose={onClose}>
        <p className="drawer-section-label">{mode === 'renew' ? 'Renouvellement — nouvelle demande, à trancher à nouveau' : 'Modifier la demande'}</p>
        <ExceptionForm
          slug={slug} mode={mode} today={today} userId={userId} members={members} controls={controls} assets={assets}
          exceptionId={mode === 'edit' ? e.id : undefined} renewedFromId={mode === 'renew' ? e.id : undefined}
          initial={{ ...e, ...win }}
          onDone={(id) => { setMode('view'); if (id !== e.id) onOpen(id); }} onCancel={() => setMode('view')}
        />
      </Drawer>
    );
  }

  return (
    <Drawer header={header} labelId="drg-title" onClose={onClose}>
      <div className="drawer-section">
        <h2 className="drg-title">{e.title}</h2>
        <dl className="drg-facts">
          <div><dt>Règle concernée</dt><dd>{e.rule}</dd></div>
          {e.controlTitle ? <div><dt>Contrôle</dt><dd>{e.controlTitle}</dd></div> : null}
          {e.assetName && e.assetId ? <div><dt>Actif</dt><dd><a href={`/t/${slug}/actifs?ouvrir=${e.assetId}`}>{e.assetName}</a></dd></div> : null}
          <div><dt>Validité</dt><dd>du {fmt(e.startsOn)} au {fmt(e.expiresOn)}{remain ? <span className={`drg-remaining drg-remaining--${e.state}`}> · {remain}</span> : null}</dd></div>
          <div><dt>Responsable</dt><dd>{e.ownerName ?? '—'}</dd></div>
        </dl>
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Pourquoi la règle ne s’applique pas</p>
        <p className="drg-text">{e.justification}</p>
        <p className="drawer-section-label">Mesures compensatoires</p>
        <p className="drg-text">{e.compensatingMeasures}</p>
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Historique</p>
        <ol className="drg-timeline">
          <li>Demandée par <b>{e.requesterName ?? '—'}</b> le {fmtInstant(e.createdAt)}.</li>
          {origin ? <li>Renouvelle <button type="button" className="link-button" onClick={() => onOpen(origin.id)}>{refCode('DRG', origin.id)}</button>, valable jusqu’au {fmt(origin.expiresOn)}.</li> : null}
          {e.status !== 'demandee' && e.deciderName ? (
            <li className={e.status === 'refusee' ? 'drg-timeline--refusee' : 'drg-timeline--accordee'}>
              {e.status === 'refusee' ? 'Refusée' : 'Accordée'} par <b>{e.deciderName}</b> le {fmtInstant(e.decidedAt)}{e.decisionNote ? <> : « {e.decisionNote} »</> : '.'}
            </li>
          ) : null}
          {e.closedAt ? <li>Clôturée par <b>{e.closerName ?? '—'}</b> le {fmtInstant(e.closedAt)}{e.closureNote ? <> : « {e.closureNote} »</> : '.'}</li> : null}
          {renewal ? (
            <li>
              Renouvellement {renewal.status === 'approuvee' ? 'accordé' : 'demandé'} :{' '}
              <button type="button" className="link-button" onClick={() => onOpen(renewal.id)}>{refCode('DRG', renewal.id)}</button>, jusqu’au {fmt(renewal.expiresOn)}.
            </li>
          ) : null}
        </ol>
      </div>

      {e.status === 'demandee' ? (
        decision.ok ? (
          <DecisionPanel slug={slug} exceptionId={e.id} />
        ) : canDecideExceptions(role) ? (
          <p className="drg-hint">{decision.reason}</p>
        ) : (
          <p className="drg-hint">En attente de la décision de la direction, du RSSI ou du responsable qualité.</p>
        )
      ) : null}

      {canEdit || canRenew || canClose ? (
        <div className="drawer-section drg-actions">
          {canEdit ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('edit')}>Modifier la demande</button> : null}
          {canRenew ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('renew')}>Renouveler</button> : null}
          {canClose ? <ClosePanel slug={slug} exceptionId={e.id} pending={e.status === 'demandee'} /> : null}
        </div>
      ) : null}
    </Drawer>
  );
}

function DecisionPanel({ slug, exceptionId }: { slug: string; exceptionId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    if (!approve && note.trim().length < 5) {
      setError('Motivez le refus : le demandeur doit savoir pourquoi l’écart n’est pas accepté.');
      return;
    }
    start(async () => {
      const r = await decideExceptionAction(slug, { exceptionId, approve, note: note.trim() || null });
      if (r.ok) router.refresh(); else setError(r.error.message);
    });
  }

  return (
    <div className="drawer-section drg-decision">
      <p className="drawer-section-label">Décision</p>
      <label className="field">Conditions ou motif
        <textarea rows={2} maxLength={2000} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Accordée sous réserve de… / Refusée car…" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => decide(false)} disabled={pending}>Refuser</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(true)} disabled={pending}>{pending ? 'Enregistrement…' : 'Accorder la dérogation'}</button>
      </div>
    </div>
  );
}

function ClosePanel({ slug, exceptionId, pending: isRequest }: { slug: string; exceptionId: string; pending: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const r = await closeExceptionAction(slug, { exceptionId, note: String(fd.get('note') ?? '').trim() || null });
      if (r.ok) { setOpen(false); router.refresh(); } else setError(r.error.message);
    });
  }

  if (!open) {
    return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{isRequest ? 'Retirer la demande' : 'Clôturer'}</button>;
  }
  return (
    <form onSubmit={keepValues(submit)} className="drg-close">
      <label className="field">{isRequest ? 'Pourquoi retirer la demande ?' : 'Pourquoi clôturer ? (règle rétablie, besoin disparu…)'}
        <textarea name="note" rows={2} maxLength={2000} />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Clôture…' : isRequest ? 'Retirer la demande' : 'Clôturer la dérogation'}</button>
      </div>
    </form>
  );
}

// ── Formulaire : demande, modification, renouvellement ─────────────────
interface FormInitial {
  title: string; rule: string; justification: string; compensatingMeasures: string;
  controlId: string | null; assetId: string | null; ownerUserId: string; startsOn: string; expiresOn: string;
}

function ExceptionForm({ slug, mode, today, userId, members, controls, assets, initial, exceptionId, renewedFromId, onDone, onCancel }: {
  slug: string; mode: 'create' | 'edit' | 'renew'; today: string; userId: string; members: TenantMember[];
  controls: Lite[]; assets: Lite[]; initial?: FormInitial; exceptionId?: string; renewedFromId?: string;
  onDone: (exceptionId: string) => void; onCancel: () => void;
}) {
  const router = useRouter();
  const start0 = initial?.startsOn ?? today;
  const [startsOn, setStartsOn] = useState(start0);
  const [expiresOn, setExpiresOn] = useState(initial?.expiresOn ?? defaultExceptionWindow(start0).expiresOn);
  const [rule, setRule] = useState(initial?.rule ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const max = maxExceptionExpiry(startsOn);

  function changeStart(value: string) {
    setStartsOn(value);
    // L'échéance suit le début si elle sort de la fenêtre autorisée.
    if (value && (expiresOn <= value || expiresOn > maxExceptionExpiry(value))) setExpiresOn(defaultExceptionWindow(value).expiresOn);
  }

  function pickControl(id: string) {
    const c = controls.find((x) => x.id === id);
    if (c && rule.trim() === '') setRule(`Contrôle « ${c.label} »`);
  }

  function submit(fd: FormData) {
    setError(null);
    const content = {
      title: String(fd.get('title') ?? ''),
      rule,
      justification: String(fd.get('justification') ?? ''),
      compensatingMeasures: String(fd.get('compensatingMeasures') ?? ''),
      controlId: String(fd.get('controlId') ?? '') || null,
      assetId: String(fd.get('assetId') ?? '') || null,
      ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
      startsOn,
      expiresOn,
    };
    start(async () => {
      if (mode === 'edit' && exceptionId) {
        const r = await updateExceptionAction(slug, { exceptionId, ...content });
        if (r.ok) { router.refresh(); onDone(exceptionId); } else setError(r.error.message);
        return;
      }
      const r = await requestExceptionAction(slug, { ...content, renewedFromId: renewedFromId ?? null });
      if (r.ok) { router.refresh(); onDone(r.data.exceptionId); } else setError(r.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)}>
      <label className="field">Intitulé
        <input name="title" required minLength={2} maxLength={200} defaultValue={initial?.title ?? ''} placeholder="Poste de pilotage de la trieuse sans antivirus" />
      </label>
      <div className="risk-form-grid">
        <label className="field">Contrôle concerné
          <select name="controlId" defaultValue={initial?.controlId ?? ''} onChange={(ev) => pickControl(ev.target.value)}>
            <option value="">— Aucun —</option>
            {controls.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="field">Actif concerné
          <select name="assetId" defaultValue={initial?.assetId ?? ''}>
            <option value="">— Aucun —</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
      </div>
      <label className="field">Règle concernée
        <input name="rule" required minLength={2} maxLength={300} value={rule} onChange={(ev) => setRule(ev.target.value)} placeholder="PSSI §6.2 — antivirus géré sur tous les postes de travail" />
      </label>
      <label className="field">Pourquoi la règle ne peut pas s’appliquer
        <textarea name="justification" rows={3} required minLength={10} maxLength={4000} defaultValue={initial?.justification ?? ''} placeholder="Contrainte technique, contractuelle ou métier, et ce qui permettra d’en sortir…" />
      </label>
      <label className="field">Mesures compensatoires
        <textarea name="compensatingMeasures" rows={3} required minLength={3} maxLength={4000} defaultValue={initial?.compensatingMeasures ?? ''} placeholder="Ce qui réduit le risque pendant l’écart : isolement réseau, surveillance renforcée…" />
      </label>
      <div className="risk-form-grid">
        <label className="field field--full">Responsable de la dérogation
          <select name="ownerUserId" defaultValue={initial?.ownerUserId ?? userId}>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.userId === userId ? ' (vous)' : ''}</option>)}
          </select>
        </label>
        <label className="field">Début
          <input type="date" required value={startsOn} onChange={(ev) => changeStart(ev.target.value)} />
        </label>
        <label className="field">Fin (dernier jour)
          <input type="date" required value={expiresOn} min={startsOn} max={max} onChange={(ev) => setExpiresOn(ev.target.value)} />
        </label>
      </div>
      <p className="drg-hint">{EXCEPTION_MAX_MONTHS} mois au plus, soit jusqu’au {fmt(max)}. Au-delà, on renouvelle et une décision est prise à nouveau.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? 'Enregistrement…' : mode === 'edit' ? 'Enregistrer' : mode === 'renew' ? 'Demander le renouvellement' : 'Soumettre la demande'}
        </button>
      </div>
    </form>
  );
}
