'use client';

import { suggestedValidUntil, type EvidenceRecurrence, type FreshnessState } from '@toron/core';
import type { AccessLogRow, EvidenceHistoryRow, EvidenceLinkRow, EvidenceSummary } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { refCode, todayParis } from '@/lib/format';
import { useOpenItem } from '@/lib/use-open-item';

import {
  createEvidenceAction,
  getEvidenceDetailAction,
  renewEvidenceAction,
  toggleEvidenceControlAction,
} from './evidence-actions';

type ControlLite = { id: string; title: string };

const FRESH_LABEL: Record<FreshnessState, string> = { expiree: 'Expirée', bientot: 'Bientôt', fraiche: 'Fraîche', permanente: 'Permanente' };
const TYPE_LABEL: Record<string, string> = { capture: 'Capture', export: 'Export', attestation: 'Attestation', rapport: 'Rapport', pv: 'PV' };
const RECURRENCE_LABEL: Record<string, string> = { ponctuelle: 'Ponctuelle', trimestrielle: 'Trimestrielle', semestrielle: 'Semestrielle', annuelle: 'Annuelle' };

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
function FreshTag({ f }: { f: FreshnessState }) {
  return <span className={`fresh-tag fresh--${f}`}>{FRESH_LABEL[f]}</span>;
}

export function EvidenceVault({ slug, canManage, evidences, controls }: { slug: string; canManage: boolean; evidences: EvidenceSummary[]; controls: ControlLite[] }) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [withHistory, setWithHistory] = useState(false);
  const [openId, setOpenId] = useOpenItem(evidences.map((x) => x.id));
  const current = useMemo(() => evidences.filter((e) => e.supersededById === null), [evidences]);
  const historyCount = evidences.length - current.length;

  // Les indicateurs ne portent que sur les preuves en vigueur.
  const stats = useMemo(() => {
    const total = current.length;
    const expired = current.filter((e) => e.freshness === 'expiree').length;
    const soon = current.filter((e) => e.freshness === 'bientot').length;
    const upToDate = total === 0 ? null : Math.round(((total - expired) / total) * 100);
    return { total, expired, soon, upToDate };
  }, [current]);

  const shown = useMemo(() => {
    const base = withHistory ? evidences : current;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((e) => e.title.toLowerCase().includes(q) || refCode('EVI', e.id).toLowerCase().includes(q) || e.sha256.includes(q));
  }, [evidences, current, withHistory, query]);
  const open = openId ? evidences.find((e) => e.id === openId) ?? null : null;

  return (
    <>
      <div className="ds-stat-row">
        <div className="ds-stat"><span className="ds-stat-value">{stats.upToDate === null ? '—' : `${stats.upToDate}%`}</span><span className="ds-stat-label">à jour</span></div>
        <div className="ds-stat"><span className={`ds-stat-value${stats.expired > 0 ? ' alert' : ''}`}>{stats.expired}</span><span className="ds-stat-label">expirée{stats.expired > 1 ? 's' : ''}</span></div>
        <div className="ds-stat"><span className="ds-stat-value">{stats.soon}</span><span className="ds-stat-label">expirent sous 30 j</span></div>
      </div>

      <div className="ds-toolbar">
        <div className="ds-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 20.5 20.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher — EVI-031, titre, empreinte" />
        </div>
        {historyCount > 0 ? (
          <label className="evi-history-toggle">
            <input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} />
            Afficher les versions remplacées ({historyCount})
          </label>
        ) : null}
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Ajouter une preuve</button> : null}
      </div>

      {shown.length === 0 ? (
        <div className="empty-state"><h2>Coffre vide</h2><p>Téléversez une preuve et rattachez-la à un contrôle. La collecte est manuelle au départ ; les connecteurs automatiques viendront.</p></div>
      ) : (
        <div className="ds-table-card">
          <div className="ds-scroll">
            <table className="ds-table" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th style={{ width: 72 }}>ID</th>
                  <th style={{ minWidth: 240 }}>Preuve</th>
                  <th style={{ width: 96 }}>Fraîcheur</th>
                  <th style={{ width: 92 }}>Collectée</th>
                  <th style={{ width: 100 }}>Valide au</th>
                  <th style={{ width: 108 }}>Récurrence</th>
                  <th style={{ width: 64 }}>Liens</th>
                  <th style={{ width: 110 }}>Empreinte</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} onClick={() => setOpenId(e.id)} className={e.supersededById ? 'row-superseded' : undefined}>
                    <td className="ds-id">{refCode('EVI', e.id)}</td>
                    <td><div className="ds-primary">{e.title}<small>{TYPE_LABEL[e.type] ?? e.type} · {e.collectorName ?? '—'}</small></div></td>
                    <td>{e.supersededById ? <span className="fresh-tag fresh--permanente">Remplacée</span> : <FreshTag f={e.freshness} />}</td>
                    <td className="ds-mono">{fmtDate(e.collectedAt)}</td>
                    <td className="ds-mono" style={{ color: e.freshness === 'expiree' ? 'var(--danger)' : undefined }}>{fmtDate(e.validUntil)}</td>
                    <td className="ds-muted">{RECURRENCE_LABEL[e.recurrence] ?? e.recurrence}</td>
                    <td className="ds-mono">{e.linkCount}</td>
                    <td className="ds-mono" title={e.sha256}>{e.sha256.slice(0, 10)}…</td>
                    <td onClick={(ev) => ev.stopPropagation()}>{e.hasContent ? <a className="link-btn" href={`/t/${slug}/preuves/${e.id}`}>Télécharger</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating ? <CreateDialog slug={slug} controls={controls} onClose={() => setCreating(false)} /> : null}
      {open ? <DetailDrawer key={open.id} slug={slug} ev={open} controls={controls} canManage={canManage} onOpen={setOpenId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function CreateDialog({ slug, controls, onClose }: { slug: string; controls: ControlLite[]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  function submit(fd: FormData) {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choisissez un fichier.'); return; }
    fd.set('file', file);
    start(async () => { const res = await createEvidenceAction(slug, fd); if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message); });
  }
  return (
    <Dialog title="Nouvelle preuve" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="PV de test de restauration…" /></label>
        <div className="risk-form-grid">
          <label className="field">Type<select name="type" defaultValue="export">{Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field">Récurrence<select name="recurrence" defaultValue="ponctuelle">{Object.entries(RECURRENCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field">Date de collecte<input type="date" name="collectedAt" required /></label>
          <label className="field">Valide jusqu’au<input type="date" name="validUntil" /></label>
          <label className="field field--full">Contrôle couvert (mutualisation)<select name="controlId" defaultValue=""><option value="">— Aucun —</option>{controls.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        </div>
        <div className="upload-drop">
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.md,.docx,.xlsx,.zip,.json" required />
          <p className="risk-mut-hint" style={{ margin: 0 }}>Empreinte SHA-256 calculée à l’ingestion. 10 Mo max.</p>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Ingestion…' : 'Ajouter la preuve'}</button></div>
      </form>
    </Dialog>
  );
}

function DetailDrawer({ slug, ev, controls, canManage, onOpen, onClose }: { slug: string; ev: EvidenceSummary; controls: ControlLite[]; canManage: boolean; onOpen: (id: string) => void; onClose: () => void }) {
  const router = useRouter();
  const [links, setLinks] = useState<EvidenceLinkRow[] | null>(null);
  const [access, setAccess] = useState<AccessLogRow[]>([]);
  const [history, setHistory] = useState<EvidenceHistoryRow[]>([]);
  const [pending, start] = useTransition();
  const superseded = ev.supersededById !== null;

  const apply = (data: { links: EvidenceLinkRow[]; access: AccessLogRow[]; history: EvidenceHistoryRow[] }) => {
    setLinks(data.links); setAccess(data.access); setHistory(data.history);
  };
  const reload = () => getEvidenceDetailAction(slug, ev.id).then((res) => { if (res.ok) apply(res.data); });
  useEffect(() => {
    let alive = true;
    getEvidenceDetailAction(slug, ev.id).then((res) => { if (alive && res.ok) apply(res.data); });
    return () => { alive = false; };
  }, [slug, ev.id]);

  const linkedControlIds = new Set((links ?? []).filter((l) => l.targetType === 'control').map((l) => l.targetId));
  function toggle(controlId: string, next: boolean) {
    start(async () => { const res = await toggleEvidenceControlAction(slug, { evidenceId: ev.id, controlId, linked: next }); if (res.ok) { await reload(); router.refresh(); } });
  }

  const header = (
    <>
      <span className="ds-id" id="evi-drawer-title">{refCode('EVI', ev.id)}</span>
      {superseded ? <span className="fresh-tag fresh--permanente">Remplacée</span> : <FreshTag f={ev.freshness} />}
      <span className="ds-chip">{TYPE_LABEL[ev.type] ?? ev.type}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="evi-drawer-title" onClose={onClose}>
      <div className="drawer-section">
        <div className="ds-primary" style={{ fontSize: 14 }}>{ev.title}</div>
        <p className="ds-mono" style={{ marginTop: 6, wordBreak: 'break-all' }} title={ev.sha256}>SHA-256 {ev.sha256}</p>
        <p className="ds-muted" style={{ marginTop: 4 }}>Collectée le {fmtDate(ev.collectedAt)} · valide jusqu’au {fmtDate(ev.validUntil)} · {RECURRENCE_LABEL[ev.recurrence] ?? ev.recurrence}</p>
        {ev.hasContent ? <a className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} href={`/t/${slug}/preuves/${ev.id}`}>Télécharger</a> : null}
        {superseded ? (
          <p className="evi-superseded">
            Version historique, remplacée le {ev.supersededAt ? new Date(ev.supersededAt).toLocaleDateString('fr-FR') : '—'}.{' '}
            <button type="button" className="link-btn" onClick={() => onOpen(ev.supersededById!)}>Ouvrir la version en vigueur ({refCode('EVI', ev.supersededById!)})</button>
          </p>
        ) : null}
      </div>

      {canManage && !superseded ? <RenewSection slug={slug} ev={ev} onRenewed={(id) => { onOpen(id); window.setTimeout(() => router.refresh(), 0); }} /> : null}

      <div className="drawer-section">
        <p className="drawer-section-label">Contrôles couverts (mutualisation)</p>
        {links === null ? <p className="risk-mut-hint">Chargement…</p> : controls.length === 0 ? <p className="risk-mut-hint">Aucun contrôle interne à rattacher.</p> : (
          <div className="control-link-list">
            {controls.map((c) => (
              <label className="control-link-row" key={c.id}><input type="checkbox" checked={linkedControlIds.has(c.id)} disabled={!canManage || superseded || pending} onChange={(e) => toggle(c.id, e.target.checked)} />{c.title}</label>
            ))}
          </div>
        )}
      </div>

      {history.length > 0 ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Versions précédentes</p>
          <div className="access-log">
            {history.map((h) => (
              <div className="access-row" key={h.id}>
                <button type="button" className="link-btn" onClick={() => onOpen(h.id)}>{refCode('EVI', h.id)}</button>
                <span className="ds-mono">collectée {fmtDate(h.collectedAt)} · valide au {fmtDate(h.validUntil)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="drawer-section">
        <p className="drawer-section-label">Journal des accès</p>
        {access.length === 0 ? <p className="risk-mut-hint">Aucun accès enregistré.</p> : (
          <div className="access-log">
            {access.map((a, i) => <div className="access-row" key={i}><span>{a.userName ?? 'Utilisateur'} — {a.kind}</span><span className="ds-mono">{new Date(a.at).toLocaleString('fr-FR')}</span></div>)}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function RenewSection({ slug, ev, onRenewed }: { slug: string; ev: EvidenceSummary; onRenewed: (id: string) => void }) {
  const today = todayParis();
  const [collectedAt, setCollectedAt] = useState(today);
  const [validUntil, setValidUntil] = useState(suggestedValidUntil(today, ev.recurrence as EvidenceRecurrence) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const urgent = ev.freshness === 'expiree' || ev.freshness === 'bientot';

  function changeCollected(v: string) {
    setCollectedAt(v);
    if (v) setValidUntil(suggestedValidUntil(v, ev.recurrence as EvidenceRecurrence) ?? '');
  }
  function submit() {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choisissez le nouveau fichier de preuve.'); return; }
    const fd = new FormData();
    fd.set('previousId', ev.id); fd.set('collectedAt', collectedAt); fd.set('validUntil', validUntil); fd.set('file', file);
    start(async () => {
      const res = await renewEvidenceAction(slug, fd);
      if (res.ok) onRenewed(res.data.evidenceId); else setError(res.error.message);
    });
  }

  return (
    <div className={`drawer-section evi-renew${urgent ? ' evi-renew--urgent' : ''}`}>
      <p className="drawer-section-label">Renouveler la preuve</p>
      <p className="ds-muted">
        Déposez la nouvelle collecte : elle reprend les contrôles couverts, et cette version reste consultable
        dans l’historique.
      </p>
      <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.md,.docx,.xlsx,.zip,.json" aria-label="Nouveau fichier de preuve" />
      <div className="risk-form-grid">
        <label className="field">Date de collecte<input type="date" value={collectedAt} max={today} onChange={(e) => changeCollected(e.target.value)} required /></label>
        <label className="field">Valide jusqu’au<input type="date" value={validUntil} min={collectedAt} onChange={(e) => setValidUntil(e.target.value)} /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={submit}>{pending ? 'Renouvellement…' : 'Renouveler'}</button>
    </div>
  );
}
