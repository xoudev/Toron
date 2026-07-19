'use client';

import type { AuditDetail, AuditSummary, FrameworkSummary, ScopeSummary, TenantMember } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';

import { addFindingAction, convertFindingAction, createAuditAction, getAuditAction, setAuditStatusAction } from './audit-actions';

const STATUS_LABEL: Record<string, string> = { planifie: 'Planifié', en_cours: 'En cours', clos: 'Clos' };
const STATUSES = ['planifie', 'en_cours', 'clos'] as const;
const FTYPE_LABEL: Record<string, string> = { conforme: 'Conforme', observation: 'Observation', nc_mineure: 'NC mineure', nc_majeure: 'NC majeure' };
const FTYPE_CLASS: Record<string, string> = { conforme: 'efficace', observation: 'en_traitement', nc_mineure: 'cloturee_a_verifier', nc_majeure: 'ouverte' };

function fmt(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function AuditBoard({ slug, canManage, audits, frameworks, scopes, members }: { slug: string; canManage: boolean; audits: AuditSummary[]; frameworks: FrameworkSummary[]; scopes: ScopeSummary[]; members: TenantMember[] }) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="ds-toolbar">
        <span className="drawer-section-label" style={{ margin: 0 }}>Programme · {audits.length}</span>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Programmer un audit</button> : null}
      </div>

      {audits.length === 0 ? (
        <div className="empty-state"><h2>Aucun audit</h2><p>Programmez un audit interne et consignez ses constats.</p></div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 880 }}>
            <thead><tr><th style={{ width: 74 }}>ID</th><th style={{ minWidth: 240 }}>Audit</th><th style={{ width: 130 }}>Référentiel</th><th style={{ width: 96 }}>Prévu</th><th style={{ width: 140 }}>Auditeur</th><th style={{ width: 80 }}>Constats</th><th style={{ width: 110 }}>Statut</th></tr></thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id} onClick={() => setOpenId(a.id)}>
                  <td className="ds-id">{refCode('AUD', a.id)}</td>
                  <td><div className="ds-primary">{a.title}{a.scopeName ? <small>{a.scopeName}</small> : null}</div></td>
                  <td className="ds-muted">{a.frameworkName ?? '—'}</td>
                  <td className="ds-mono">{fmt(a.plannedAt)}</td>
                  <td><div className="ds-owner"><span className="ds-avatar">{initials(a.leadName)}</span><span>{a.leadName ?? '—'}</span></div></td>
                  <td className="ds-mono">{a.findingCount}{a.ncCount > 0 ? <span style={{ color: 'var(--danger)' }}> · {a.ncCount} NC</span> : null}</td>
                  <td><span className={`nc-status ncs--${a.status === 'clos' ? 'efficace' : a.status === 'en_cours' ? 'en_traitement' : 'ouverte'}`}>{STATUS_LABEL[a.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? <CreateDialog slug={slug} frameworks={frameworks} scopes={scopes} members={members} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : null}
      {openId ? <AuditDrawer slug={slug} auditId={openId} canManage={canManage} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function AuditDrawer({ slug, auditId, canManage, onClose }: { slug: string; auditId: string; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<AuditDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [ftype, setFtype] = useState('observation');
  const [desc, setDesc] = useState('');
  const [pending, start] = useTransition();

  const reload = () => getAuditAction(slug, auditId).then((r) => { if (r.ok) setD(r.data); });
  useEffect(() => { let a = true; getAuditAction(slug, auditId).then((r) => { if (a && r.ok) setD(r.data); }); return () => { a = false; }; }, [slug, auditId]);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => { const res = await fn(); if (res.ok) { await reload(); router.refresh(); } else setError(res.error?.message ?? 'Refusé.'); });
  }
  if (!d) return null;

  const header = (
    <>
      <span className="ds-id" id="aud-title">{refCode('AUD', d.id)}</span>
      <span className={`nc-status ncs--${d.status === 'clos' ? 'efficace' : d.status === 'en_cours' ? 'en_traitement' : 'ouverte'}`}>{STATUS_LABEL[d.status]}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="aud-title" onClose={onClose}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{d.title}</h2>
      <div className="ds-muted" style={{ marginBottom: 12 }}>{d.frameworkName ?? '—'} · {d.scopeName ?? '—'} · auditeur {d.leadName ?? '—'}</div>

      {canManage ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Statut</p>
          <div className="status-flow">
            {STATUSES.map((s) => <button key={s} className="btn btn-ghost btn-sm" aria-pressed={d.status === s} disabled={pending} onClick={() => run(() => setAuditStatusAction(slug, { auditId: d.id, status: s }))}>{STATUS_LABEL[s]}</button>)}
          </div>
        </div>
      ) : null}

      <div className="drawer-section">
        <p className="drawer-section-label">Constats · {d.findings.length}</p>
        {d.findings.length === 0 ? <p className="risk-mut-hint">Aucun constat.</p> : d.findings.map((f) => (
          <div className="nc-step" key={f.id} style={{ padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className={`nc-status ncs--${FTYPE_CLASS[f.type]}`}>{FTYPE_LABEL[f.type]}</span>
              {f.requirementRef ? <span className="chip-ref">{f.requirementRef}</span> : null}
              {f.actionId ? <span className="ds-id" style={{ marginLeft: 'auto', color: 'var(--ok)' }}>→ action</span> : null}
            </div>
            <div style={{ fontSize: 12.5 }}>{f.description}</div>
            {canManage && !f.actionId && (f.type === 'nc_mineure' || f.type === 'nc_majeure') ? (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} disabled={pending} onClick={() => run(() => convertFindingAction(slug, { findingId: f.id, auditId: d.id, title: `Corriger — ${f.requirementRef ?? 'constat'} : ${f.description.slice(0, 80)}` }))}>Convertir en action corrective</button>
            ) : null}
          </div>
        ))}
      </div>

      {canManage ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Nouveau constat</p>
          <div className="risk-form-grid">
            <label className="field">Exigence<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="A.8.13" /></label>
            <label className="field">Type<select value={ftype} onChange={(e) => setFtype(e.target.value)}>{Object.entries(FTYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <label className="field">Description<textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <button className="btn btn-primary btn-sm" disabled={pending || desc.trim().length < 2} onClick={() => run(async () => { const r = await addFindingAction(slug, { auditId: d.id, requirementRef: ref.trim() || null, type: ftype, description: desc.trim() }); if (r.ok) { setRef(''); setDesc(''); setFtype('observation'); } return r; })}>Ajouter le constat</button>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}

function CreateDialog({ slug, frameworks, scopes, members, onClose, onCreated }: { slug: string; frameworks: FrameworkSummary[]; scopes: ScopeSummary[]; members: TenantMember[]; onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createAuditAction(slug, { title: String(fd.get('title') ?? ''), frameworkId: String(fd.get('frameworkId') ?? '') || null, scopeId: String(fd.get('scopeId') ?? '') || null, plannedAt: String(fd.get('plannedAt') ?? '') || null, leadAuditor: String(fd.get('leadAuditor') ?? '') || null });
      if (res.ok) { router.refresh(); onCreated(res.data.id); } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Programmer un audit" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="Audit interne SMSI — S2 2026" /></label>
        <div className="risk-form-grid">
          <label className="field">Référentiel<select name="frameworkId" defaultValue=""><option value="">—</option>{frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label className="field">Périmètre<select name="scopeId" defaultValue={scopes[0]?.id ?? ''}><option value="">—</option>{scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="field">Date prévue<input type="date" name="plannedAt" /></label>
          <label className="field">Auditeur (chef)<select name="leadAuditor" defaultValue=""><option value="">—</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
        </div>
        <p className="risk-mut-hint">Séparation des tâches (S5) : l’auditeur ne doit pas être responsable du périmètre audité.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Programmer'}</button></div>
      </form>
    </Dialog>
  );
}
