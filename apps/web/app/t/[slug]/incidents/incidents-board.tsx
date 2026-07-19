'use client';

import { deadlineState, hoursUntil, type NotifKind } from '@toron/core';
import type { IncidentDetail, IncidentSummary } from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { refCode } from '@/lib/format';

import {
  addEventAction,
  closeIncidentAction,
  createIncidentAction,
  getIncidentAction,
  markNotifSentAction,
  qualifyIncidentAction,
} from './incident-actions';

const SEVERITY_LABEL: Record<string, string> = { mineur: 'Mineur', majeur: 'Majeur', critique: 'Critique' };
const STATUS_LABEL: Record<string, string> = { ouvert: 'Ouvert', qualifie: 'Qualifié', clos: 'Clos' };
const NOTIF_LABEL: Record<NotifKind, string> = {
  alerte_24h: 'Alerte 24 h (ANSSI)',
  notification_72h: 'Notification 72 h (ANSSI)',
  rapport_30j: 'Rapport final J+30 (ANSSI)',
  cnil_72h: 'Notification CNIL 72 h (RGPD)',
};
const CRITERIA: { key: string; label: string }[] = [
  { key: 'perturbation_operationnelle', label: 'Perturbation opérationnelle grave' },
  { key: 'pertes_financieres', label: 'Pertes financières importantes' },
  { key: 'impact_tiers', label: 'Impact sur des tiers' },
];

function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function countdownText(dueAt: Date, sentAt: Date | null, now: Date): string {
  if (sentAt) return `Transmise le ${fmtDateTime(sentAt)}`;
  const h = hoursUntil(dueAt, now);
  if (h < 0) return `Échéance dépassée (il y a ${Math.abs(h)} h)`;
  if (h < 48) return `Échéance dans ${h} h`;
  return `Échéance dans ${Math.round(h / 24)} j`;
}

export function IncidentsBoard({ slug, canManage, incidents }: { slug: string; canManage: boolean; incidents: IncidentSummary[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(incidents[0]?.id ?? null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="ds-toolbar">
        <span className="drawer-section-label" style={{ margin: 0 }}>File des incidents · {incidents.length}</span>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Déclarer un incident</button> : null}
      </div>

      {incidents.length === 0 ? (
        <div className="empty-state"><h2>Aucun incident ouvert</h2><p>Déclarez un incident pour armer la chronologie réglementaire NIS 2.</p></div>
      ) : (
        <div className="inc-layout">
          <div className="inc-list">
            {incidents.map((i) => (
              <button key={i.id} className={`inc-item sev--${i.severity}`} aria-pressed={selectedId === i.id} onClick={() => setSelectedId(i.id)}>
                <div className="inc-item-title">{i.title}</div>
                <div className="inc-item-meta">
                  <span className="ds-id">{refCode('INC', i.id)}</span>
                  <span className="sev-tag">{SEVERITY_LABEL[i.severity]}</span>
                  <span className="inc-status">{STATUS_LABEL[i.status]}</span>
                  {i.nis2Important ? <span className="inc-status" style={{ color: 'var(--danger)' }}>NIS 2</span> : null}
                </div>
              </button>
            ))}
          </div>
          {selectedId ? <IncidentDetailPanel slug={slug} incidentId={selectedId} canManage={canManage} /> : null}
        </div>
      )}

      {creating ? <CreateDialog slug={slug} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id); }} /> : null}
    </>
  );
}

function IncidentDetailPanel({ slug, incidentId, canManage }: { slug: string; incidentId: string; canManage: boolean }) {
  const router = useRouter();
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const now = new Date();

  const reload = () => getIncidentAction(slug, incidentId).then((r) => { if (r.ok) setDetail(r.data); });
  useEffect(() => {
    let alive = true;
    setDetail(null);
    getIncidentAction(slug, incidentId).then((r) => { if (alive && r.ok) setDetail(r.data); });
    return () => { alive = false; };
  }, [slug, incidentId]);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => { const res = await fn(); if (res.ok) { await reload(); router.refresh(); } else setError(res.error?.message ?? 'Action refusée.'); });
  }

  if (!detail) return <div className="inc-detail"><p className="risk-mut-hint">Chargement…</p></div>;
  const d = detail;

  return (
    <div className="inc-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <span className="ds-id">{refCode('INC', d.id)}</span>
        <span className={`sev-tag sev--${d.severity}`}>{SEVERITY_LABEL[d.severity]}</span>
        <span className="inc-status">{STATUS_LABEL[d.status]}</span>
      </div>
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{d.title}</h2>
      {d.description ? <p className="ds-muted" style={{ marginBottom: 14 }}>{d.description}</p> : null}

      {d.status === 'ouvert' ? (
        <QualifyForm slug={slug} incidentId={d.id} canManage={canManage} onDone={() => run(async () => ({ ok: true }))} />
      ) : (
        <>
          <div className={`nis2-banner${d.nis2Important ? '' : ' plain'}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3.5 19 6.2v4.8c0 4-3 6.8-7 8-4-1.2-7-4-7-8V6.2z" /><path d="M9 11.2l2 2 4-4" /></svg>
            <div>{d.nis2Important ? <><b>Incident important — NIS 2</b> · qualifié le {d.qualifiedAt ? fmtDateTime(d.qualifiedAt) : '—'}</> : <>Qualifié — <b>non important</b> au sens NIS 2</>}</div>
          </div>

          {d.nis2Criteria ? (
            <div style={{ marginBottom: 14 }}>
              <p className="drawer-section-label">Critères retenus</p>
              <div className="crit-list">
                {CRITERIA.map((c) => (
                  <div className="crit-row" key={c.key}>
                    <span style={{ color: d.nis2Criteria![c.key] ? 'var(--ok)' : 'var(--text-3)' }}>{d.nis2Criteria![c.key] ? '✓' : '○'}</span>
                    {c.label}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {d.notifications.length > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <p className="drawer-section-label">Calendrier réglementaire</p>
              <div className="reg-stepper">
                {d.notifications.map((n) => {
                  const state = deadlineState(n.dueAt, n.sentAt, now);
                  return (
                    <div className={`reg-step dl--${state}`} key={n.kind}>
                      <div className="reg-step-body">
                        <div className="reg-step-title">{NOTIF_LABEL[n.kind]}</div>
                        <div className="reg-step-sub">{countdownText(n.dueAt, n.sentAt, now)}</div>
                      </div>
                      {canManage && !n.sentAt && d.status !== 'clos' ? (
                        <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => markNotifSentAction(slug, { incidentId: d.id, kind: n.kind }))}>Marquer transmise</button>
                      ) : <span className="countdown">{n.sentAt ? '✓' : `${hoursUntil(n.dueAt, now)} h`}</span>}
                    </div>
                  );
                })}
              </div>
              {d.gdprBreach ? <div className="rgpd-panel"><b>Volet violation de données — RGPD.</b> Données personnelles concernées : l’échéance CNIL 72 h court en parallèle de la chronologie NIS 2.</div> : null}
            </div>
          ) : null}
        </>
      )}

      <div style={{ marginBottom: 14 }}>
        <p className="drawer-section-label">Chronologie · journal immuable</p>
        <div className="timeline">
          {d.events.map((e, i) => (
            <div className="tl-event" key={i}>
              <p className="tl-kind">{e.kind}</p>
              <div className="tl-desc">{e.description}</div>
              <span className="tl-when">{fmtDateTime(e.at)} · {e.authorName ?? '—'}</span>
            </div>
          ))}
        </div>
        {canManage && d.status !== 'clos' ? <AddEvent slug={slug} incidentId={d.id} onDone={() => run(async () => ({ ok: true }))} /> : null}
      </div>

      {d.status !== 'clos' && canManage ? (
        <CloseForm slug={slug} incidentId={d.id} nis2Important={d.nis2Important} onDone={() => run(async () => ({ ok: true }))} />
      ) : d.status === 'clos' ? (
        <div className="drawer-section"><p className="drawer-section-label">Retour d’expérience</p><p className="ds-muted">{d.rex ?? '—'}</p></div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}

function QualifyForm({ slug, incidentId, canManage, onDone }: { slug: string; incidentId: string; canManage: boolean; onDone: () => void }) {
  const [criteria, setCriteria] = useState<Record<string, boolean>>({});
  const [important, setImportant] = useState(false);
  const [gdpr, setGdpr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canManage) return <p className="ds-muted">Incident ouvert — en attente de qualification.</p>;

  function submit() {
    setError(null);
    start(async () => {
      const res = await qualifyIncidentAction(slug, { incidentId, nis2Important: important, gdprBreach: gdpr, criteria });
      if (res.ok) onDone(); else setError(res.error.message);
    });
  }
  return (
    <div className="rgpd-panel" style={{ borderStyle: 'solid', marginTop: 0, marginBottom: 14 }}>
      <p className="drawer-section-label" style={{ marginTop: 0 }}>Qualification NIS 2</p>
      <div className="crit-list" style={{ marginBottom: 8 }}>
        {CRITERIA.map((c) => (
          <label className="crit-row" key={c.key}><input type="checkbox" checked={!!criteria[c.key]} onChange={(e) => setCriteria((s) => ({ ...s, [c.key]: e.target.checked }))} />{c.label}</label>
        ))}
      </div>
      <label className="crit-row"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /><b>Qualifier « incident important » NIS 2</b> (arme l’échéancier)</label>
      <label className="crit-row"><input type="checkbox" checked={gdpr} onChange={(e) => setGdpr(e.target.checked)} />Données personnelles concernées (volet RGPD · CNIL 72 h)</label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={pending} onClick={submit}>{pending ? 'Qualification…' : 'Qualifier l’incident'}</button>
    </div>
  );
}

function AddEvent({ slug, incidentId, onDone }: { slug: string; incidentId: string; onDone: () => void }) {
  const [desc, setDesc] = useState('');
  const [pending, start] = useTransition();
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
      <input placeholder="Ajouter à la chronologie (mesure, communication…)" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 1 }} />
      <button className="btn btn-ghost btn-sm" disabled={pending || desc.trim().length === 0} onClick={() => start(async () => { await addEventAction(slug, { incidentId, kind: 'mesure', description: desc.trim() }); setDesc(''); onDone(); })}>Ajouter</button>
    </div>
  );
}

function CloseForm({ slug, incidentId, nis2Important, onDone }: { slug: string; incidentId: string; nis2Important: boolean; onDone: () => void }) {
  const [rex, setRex] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setError(null);
    start(async () => { const res = await closeIncidentAction(slug, { incidentId, rex: rex.trim() || null }); if (res.ok) onDone(); else setError(res.error.message); });
  }
  return (
    <div className="drawer-section" style={{ marginTop: 8 }}>
      <p className="drawer-section-label">Retour d’expérience (REX) & clôture</p>
      <textarea rows={2} value={rex} onChange={(e) => setRex(e.target.value)} placeholder={nis2Important ? 'REX obligatoire pour clore un incident important…' : 'REX (facultatif)…'} style={{ width: '100%' }} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={pending} onClick={submit}>{pending ? 'Clôture…' : 'Clôturer l’incident'}</button>
    </div>
  );
}

function CreateDialog({ slug, onClose, onCreated }: { slug: string; onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createIncidentAction(slug, { title: String(fd.get('title') ?? ''), description: String(fd.get('description') ?? '') || null, severity: String(fd.get('severity') ?? 'mineur') });
      if (res.ok) { router.refresh(); onCreated(res.data.id); } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Déclarer un incident" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="Hameçonnage ciblé…" /></label>
        <label className="field">Description<textarea name="description" rows={2} /></label>
        <label className="field">Sévérité<select name="severity" defaultValue="majeur"><option value="mineur">Mineur</option><option value="majeur">Majeur</option><option value="critique">Critique</option></select></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Déclaration…' : 'Déclarer'}</button></div>
      </form>
    </Dialog>
  );
}
