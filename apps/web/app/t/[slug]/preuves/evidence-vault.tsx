'use client';

import type { FreshnessState } from '@toron/core';
import type { AccessLogRow, EvidenceLinkRow, EvidenceSummary } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { refCode } from '@/lib/format';

import {
  createEvidenceAction,
  getEvidenceDetailAction,
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
  const [openId, setOpenId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const total = evidences.length;
    const expired = evidences.filter((e) => e.freshness === 'expiree').length;
    const soon = evidences.filter((e) => e.freshness === 'bientot').length;
    const upToDate = total === 0 ? null : Math.round(((total - expired) / total) * 100);
    return { total, expired, soon, upToDate };
  }, [evidences]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return evidences;
    return evidences.filter((e) => e.title.toLowerCase().includes(q) || refCode('EVI', e.id).toLowerCase().includes(q) || e.sha256.includes(q));
  }, [evidences, query]);
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
                  <tr key={e.id} onClick={() => setOpenId(e.id)}>
                    <td className="ds-id">{refCode('EVI', e.id)}</td>
                    <td><div className="ds-primary">{e.title}<small>{TYPE_LABEL[e.type] ?? e.type} · {e.collectorName ?? '—'}</small></div></td>
                    <td><FreshTag f={e.freshness} /></td>
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
      {open ? <DetailDrawer slug={slug} ev={open} controls={controls} canManage={canManage} onClose={() => setOpenId(null)} /> : null}
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

function DetailDrawer({ slug, ev, controls, canManage, onClose }: { slug: string; ev: EvidenceSummary; controls: ControlLite[]; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [links, setLinks] = useState<EvidenceLinkRow[] | null>(null);
  const [access, setAccess] = useState<AccessLogRow[]>([]);
  const [pending, start] = useTransition();

  const reload = () => getEvidenceDetailAction(slug, ev.id).then((res) => { if (res.ok) { setLinks(res.data.links); setAccess(res.data.access); } });
  useEffect(() => {
    let alive = true;
    getEvidenceDetailAction(slug, ev.id).then((res) => { if (alive && res.ok) { setLinks(res.data.links); setAccess(res.data.access); } });
    return () => { alive = false; };
  }, [slug, ev.id]);

  const linkedControlIds = new Set((links ?? []).filter((l) => l.targetType === 'control').map((l) => l.targetId));
  function toggle(controlId: string, next: boolean) {
    start(async () => { const res = await toggleEvidenceControlAction(slug, { evidenceId: ev.id, controlId, linked: next }); if (res.ok) { await reload(); router.refresh(); } });
  }

  const header = (
    <>
      <span className="ds-id" id="evi-drawer-title">{refCode('EVI', ev.id)}</span>
      <FreshTag f={ev.freshness} />
      <span className="ds-chip">{TYPE_LABEL[ev.type] ?? ev.type}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="evi-drawer-title" onClose={onClose}>
      <div className="drawer-section">
        <div className="ds-primary" style={{ fontSize: 14 }}>{ev.title}</div>
        <p className="ds-mono" style={{ marginTop: 6, wordBreak: 'break-all' }} title={ev.sha256}>SHA-256 {ev.sha256}</p>
        {ev.hasContent ? <a className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} href={`/t/${slug}/preuves/${ev.id}`}>Télécharger</a> : null}
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Contrôles couverts (mutualisation)</p>
        {links === null ? <p className="risk-mut-hint">Chargement…</p> : controls.length === 0 ? <p className="risk-mut-hint">Aucun contrôle interne à rattacher.</p> : (
          <div className="control-link-list">
            {controls.map((c) => (
              <label className="control-link-row" key={c.id}><input type="checkbox" checked={linkedControlIds.has(c.id)} disabled={!canManage || pending} onChange={(e) => toggle(c.id, e.target.checked)} />{c.title}</label>
            ))}
          </div>
        )}
      </div>

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
