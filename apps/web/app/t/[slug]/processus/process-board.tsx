'use client';

import { PROCESS_FAMILIES, PROCESS_FAMILY_LABEL, PROCESS_HEALTH_LABEL, SIPOC_COLUMNS, WORKFLOW_LABEL, WORKFLOW_STATUSES, type ProcessFamily, type Sipoc, type Tone } from '@toron/core';
import type { ProcessDetail, ProcessSummary, TenantMember } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';

import { addProcessRiskAction, createProcessAction, getProcessAction, removeProcessRiskAction, setProcessWorkflowAction } from './process-actions';

const WF_CLASS: Record<string, string> = { brouillon: 'ouverte', relecture: 'cloturee_a_verifier', approuve: 'en_traitement', publie: 'efficace' };
const TONE_TEXT: Record<Tone, string> = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', muted: 'var(--text-2)' };
const BAND_CLASS: Record<string, string> = { faible: 'efficace', moyen: 'cloturee_a_verifier', eleve: 'en_traitement', critique: 'ouverte' };

export function ProcessBoard({
  slug,
  canManage,
  processes,
  risks,
  members,
}: {
  slug: string;
  canManage: boolean;
  processes: ProcessSummary[];
  risks: { id: string; title: string; netBand: string | null }[];
  members: TenantMember[];
}) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="ds-toolbar">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span className="pr-legend-item"><span className="pr-health h--sain" style={{ display: 'inline-block', marginRight: 5 }} />Sain</span>
          <span className="pr-legend-item"><span className="pr-health h--a_surveiller" style={{ display: 'inline-block', marginRight: 5 }} />À surveiller</span>
          <span className="pr-legend-item"><span className="pr-health h--en_alerte" style={{ display: 'inline-block', marginRight: 5 }} />En alerte</span>
        </div>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouveau processus</button> : null}
      </div>

      {processes.length === 0 ? (
        <div className="empty-state"><h2>Aucun processus</h2><p>Cartographiez vos processus QMS par famille.</p></div>
      ) : (
        PROCESS_FAMILIES.map((fam) => {
          const inFam = processes.filter((p) => p.family === fam);
          if (inFam.length === 0) return null;
          return (
            <div className="pr-family" key={fam}>
              <p className="pr-family-label">{PROCESS_FAMILY_LABEL[fam]} · {inFam.length}</p>
              <div className="pr-grid">
                {inFam.map((p) => (
                  <div className="pr-card" key={p.id} onClick={() => setOpenId(p.id)}>
                    <div className="pr-card-top">
                      <span className={`pr-health h--${p.health}`} title={PROCESS_HEALTH_LABEL[p.health]} />
                      <span className="pr-name">{p.name}</span>
                    </div>
                    <div className="pr-card-meta">
                      <span className="ds-avatar">{initials(p.pilotName)}</span>
                      <span>{p.pilotName ?? '—'}</span>
                      {p.mutualizedCount > 0 ? <span className="pr-mut" title="Contrôles 27001 mutualisés">⟡ {p.mutualizedCount}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {creating ? <CreateDialog slug={slug} members={members} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : null}
      {openId ? <ProcessDrawer slug={slug} processId={openId} canManage={canManage} risks={risks} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function Cartouche({ sipoc }: { sipoc: Sipoc }) {
  return (
    <div className="sipoc">
      {SIPOC_COLUMNS.map((c) => (
        <div className="sipoc-col" key={c.key}>
          <h4>{c.label}</h4>
          <ul>{(sipoc[c.key] ?? []).map((it, i) => <li key={i}>{it}</li>)}{(sipoc[c.key] ?? []).length === 0 ? <li style={{ color: 'var(--text-3)' }}>—</li> : null}</ul>
        </div>
      ))}
    </div>
  );
}

function ProcessDrawer({ slug, processId, canManage, risks, onClose }: { slug: string; processId: string; canManage: boolean; risks: { id: string; title: string; netBand: string | null }[]; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<ProcessDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reload = () => getProcessAction(slug, processId).then((r) => { if (r.ok) setD(r.data); });
  useEffect(() => { let a = true; getProcessAction(slug, processId).then((r) => { if (a && r.ok) setD(r.data); }); return () => { a = false; }; }, [slug, processId]);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => { const res = await fn(); if (res.ok) { await reload(); router.refresh(); } else setError(res.error?.message ?? 'Refusé.'); });
  }
  if (!d) return null;

  const linkedIds = new Set(d.risks.map((r) => r.id));
  const addable = risks.filter((r) => !linkedIds.has(r.id));

  const header = (
    <>
      <span className="ds-id" id="pr-title">{refCode('PRC', d.id)}</span>
      <span className={`nc-status ncs--${WF_CLASS[d.workflow]}`}>{WORKFLOW_LABEL[d.workflow]}</span>
      <span className="ds-mono" style={{ color: 'var(--text-2)' }}>{d.version}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="pr-title" onClose={onClose}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{d.name}</h2>
      <div className="ds-muted" style={{ marginBottom: 12 }}>{PROCESS_FAMILY_LABEL[d.family as ProcessFamily]} · pilote {d.pilotName ?? '—'} · {PROCESS_HEALTH_LABEL[d.health]}</div>

      {canManage ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Cycle de vie</p>
          <div className="status-flow">
            {WORKFLOW_STATUSES.map((s) => <button key={s} className="btn btn-ghost btn-sm" aria-pressed={d.workflow === s} disabled={pending} onClick={() => run(() => setProcessWorkflowAction(slug, { processId: d.id, workflow: s }))}>{WORKFLOW_LABEL[s]}</button>)}
          </div>
        </div>
      ) : null}

      <div className="drawer-section">
        <p className="drawer-section-label">Cartouche SIPOC</p>
        <Cartouche sipoc={d.sipoc} />
      </div>

      {d.kpis.length > 0 ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Indicateurs</p>
          {d.kpis.map((k, i) => (
            <div className="kpi-row" key={i}>
              <div className="kpi-head"><span>{k.label}</span><span style={{ color: TONE_TEXT[k.tone], fontWeight: 600 }}>{k.actual}</span></div>
              <div className="kpi-target">cible {k.target}</div>
            </div>
          ))}
        </div>
      ) : null}

      {d.coveredRequirements.length > 0 ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Exigences couvertes</p>
          <div className="exig-list">
            {d.coveredRequirements.map((e, i) => (
              <span className={`exig ${e.mutualized ? 'mut' : ''}`} key={i}>{e.mutualized ? <span className="fil" /> : null}{e.framework} {e.code}</span>
            ))}
          </div>
          {d.mutualizedCount > 0 ? <p className="risk-mut-hint" style={{ marginTop: 6 }}>Le fil orange indique qu’un contrôle ISO 27001 s’adosse à ce processus — sécurité et qualité mutualisées.</p> : null}
        </div>
      ) : null}

      <div className="drawer-section">
        <p className="drawer-section-label">Risques liés · {d.risks.length}</p>
        {d.risks.length === 0 ? <p className="risk-mut-hint">Aucun risque rattaché.</p> : d.risks.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
            <span className="ds-id">{refCode('RSK', r.id)}</span>
            <span style={{ flex: 1 }}>{r.title}</span>
            {r.netBand ? <span className={`nc-status ncs--${BAND_CLASS[r.netBand] ?? 'ouverte'}`}>{r.netBand}</span> : null}
            {canManage ? <button aria-label="Retirer" className="link-btn" disabled={pending} onClick={() => run(() => removeProcessRiskAction(slug, { processId: d.id, riskId: r.id }))}>×</button> : null}
          </div>
        ))}
        {canManage && addable.length > 0 ? (
          <select defaultValue="" style={{ marginTop: 8 }} disabled={pending} onChange={(e) => { const v = e.target.value; if (v) run(() => addProcessRiskAction(slug, { processId: d.id, riskId: v })); e.target.value = ''; }}>
            <option value="">+ Rattacher un risque du registre…</option>
            {addable.map((r) => <option key={r.id} value={r.id}>{refCode('RSK', r.id)} · {r.title}</option>)}
          </select>
        ) : null}
      </div>

      {d.interactions.length > 0 ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Interactions</p>
          <div className="pr-interactions">
            {d.interactions.map((it, i) => <div className="pr-interaction" key={i}><span className="dir">{it.dir}</span>{it.name}</div>)}
          </div>
        </div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}

function CreateDialog({ slug, members, onClose, onCreated }: { slug: string; members: TenantMember[]; onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createProcessAction(slug, {
        family: String(fd.get('family') ?? ''),
        name: String(fd.get('name') ?? ''),
        pilotUserId: String(fd.get('pilotUserId') ?? '') || null,
        version: String(fd.get('version') ?? '') || undefined,
      });
      if (res.ok) { router.refresh(); onCreated(res.data.id); } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Nouveau processus" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="name" minLength={2} required placeholder="Préparation logistique" /></label>
        <div className="risk-form-grid">
          <label className="field">Famille<select name="family" defaultValue="realisation">{PROCESS_FAMILIES.map((f) => <option key={f} value={f}>{PROCESS_FAMILY_LABEL[f]}</option>)}</select></label>
          <label className="field">Pilote<select name="pilotUserId" defaultValue=""><option value="">—</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          <label className="field">Version<input name="version" placeholder="v1.0" /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Créer'}</button></div>
      </form>
    </Dialog>
  );
}
