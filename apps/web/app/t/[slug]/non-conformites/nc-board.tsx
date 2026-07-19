'use client';

import type { NcDetail, NcSummary } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { refCode } from '@/lib/format';

import {
  createCorrectiveActionAction,
  createNcAction,
  getNcAction,
  transitionNcAction,
  updateNcAction,
} from './nc-actions';

const SOURCE_LABEL: Record<string, string> = { interne: 'Interne', fournisseur: 'Fournisseur', reclamation_client: 'Réclamation client' };
const GRAVITY_LABEL: Record<string, string> = { mineure: 'Mineure', majeure: 'Majeure', critique: 'Critique' };
const STATUS_LABEL: Record<string, string> = { ouverte: 'Ouverte', en_traitement: 'En traitement', cloturee_a_verifier: 'À vérifier', efficace: 'Efficace', rouverte: 'Rouverte' };

function euro(n: number | null): string {
  return n == null ? '—' : `${n.toLocaleString('fr-FR')} €`;
}
function frDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
interface Whys { probleme: string; pourquoi: string[]; cause_racine: string }
function asWhys(rc: unknown): Whys {
  const r = (rc ?? {}) as Partial<Whys>;
  return { probleme: r.probleme ?? '', pourquoi: Array.isArray(r.pourquoi) ? r.pourquoi : [], cause_racine: r.cause_racine ?? '' };
}

export function NcBoard({ slug, canManage, ncs }: { slug: string; canManage: boolean; ncs: NcSummary[] }) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="ds-toolbar">
        <span className="drawer-section-label" style={{ margin: 0 }}>Registre · {ncs.length}</span>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Déclarer une NC</button> : null}
      </div>

      {ncs.length === 0 ? (
        <div className="empty-state"><h2>Aucune non-conformité</h2><p>Déclarez une NC pour lancer l’analyse de cause racine et les actions correctives.</p></div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 900 }}>
            <thead><tr>
              <th style={{ width: 74 }}>ID</th>
              <th style={{ minWidth: 260 }}>Non-conformité</th>
              <th style={{ width: 200 }}>Processus</th>
              <th style={{ width: 92 }}>Gravité</th>
              <th style={{ width: 96 }}>Coût NQ</th>
              <th style={{ width: 64 }}>CAPA</th>
              <th style={{ width: 120 }}>Statut</th>
            </tr></thead>
            <tbody>
              {ncs.map((n) => (
                <tr key={n.id} onClick={() => setOpenId(n.id)}>
                  <td className="ds-id">{refCode('NC', n.id)}</td>
                  <td><div className="ds-primary">{n.title}<small>{SOURCE_LABEL[n.source] ?? n.source}</small></div></td>
                  <td className="ds-muted">{n.processRef ?? '—'}</td>
                  <td><span className="ds-chip">{GRAVITY_LABEL[n.gravity] ?? n.gravity}</span></td>
                  <td className="nc-cost">{euro(n.costEstimate)}</td>
                  <td className="ds-mono">{n.correctiveActionCount}</td>
                  <td>
                    <span className={`nc-status ncs--${n.status}`}>{STATUS_LABEL[n.status] ?? n.status}</span>
                    {n.effectivenessDue ? <span className="nc-status ncs--cloturee_a_verifier" style={{ marginLeft: 4 }}>échue</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? <CreateDialog slug={slug} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : null}
      {openId ? <NcDrawer slug={slug} ncId={openId} canManage={canManage} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function NcDrawer({ slug, ncId, canManage, onClose }: { slug: string; ncId: string; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<NcDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reload = () => getNcAction(slug, ncId).then((r) => { if (r.ok) setD(r.data); });
  useEffect(() => { let alive = true; getNcAction(slug, ncId).then((r) => { if (alive && r.ok) setD(r.data); }); return () => { alive = false; }; }, [slug, ncId]);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => { const res = await fn(); if (res.ok) { await reload(); router.refresh(); } else setError(res.error?.message ?? 'Action refusée.'); });
  }

  if (!d) return null;
  const whys = asWhys(d.rootCause);
  const header = (
    <>
      <span className="ds-id" id="nc-drawer-title">{refCode('NC', d.id)}</span>
      <span className="ds-chip">{SOURCE_LABEL[d.source] ?? d.source}</span>
      <span className={`nc-status ncs--${d.status}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="nc-drawer-title" onClose={onClose}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{d.title}</h2>
      <div className="ds-muted" style={{ marginBottom: 14 }}>{GRAVITY_LABEL[d.gravity]} · coût NQ {euro(d.costEstimate)} · {d.processRef ?? 'processus non précisé'}</div>

      <Step n={1} title="Description & détection"><p className="ds-muted">{d.description ?? '—'}</p></Step>

      <ImmediateStep slug={slug} nc={d} canManage={canManage} onDone={reload} />
      <WhysStep slug={slug} nc={d} whys={whys} canManage={canManage} onDone={reload} />

      <Step n={4} title="Actions correctives liées (moteur commun)">
        {d.correctiveActions.length === 0 ? <p className="risk-mut-hint">Aucune action corrective.</p> : (
          <div>{d.correctiveActions.map((a) => <span className="capa-chip" key={a.id}><span className="ds-id">ACT</span>{a.title}</span>)}</div>
        )}
        {canManage ? <AddCapa slug={slug} ncId={d.id} onDone={reload} /> : null}
      </Step>

      <Step n={5} title="Clôture & vérification d’efficacité">
        {d.status === 'cloturee_a_verifier' ? (
          <>
            <div className="efficacy-note"><b>Efficacité à vérifier.</b> Clôturée ; contrôle planifié le <b>{frDate(d.effectivenessCheckAt)}</b> (J+90).{d.effectivenessDue ? ' Échéance atteinte.' : ''}</div>
            {canManage ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => transitionNcAction(slug, { ncId: d.id, transition: 'confirm' }))}>Confirmer l’efficacité</button>
                <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => transitionNcAction(slug, { ncId: d.id, transition: 'reopen' }))}>Rouvrir la NC</button>
              </div>
            ) : null}
          </>
        ) : d.status === 'efficace' ? (
          <p style={{ color: 'var(--ok)', fontSize: 13 }}>✓ Efficacité confirmée — non-conformité soldée.</p>
        ) : (
          <>
            <p className="ds-muted" style={{ marginBottom: 8 }}>À la clôture, Toron planifie automatiquement une vérification d’efficacité à J+90.</p>
            {canManage ? <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => transitionNcAction(slug, { ncId: d.id, transition: 'close' }))}>Clôturer la NC</button> : null}
          </>
        )}
      </Step>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="nc-step">
      <div className="nc-step-head"><span className="nc-step-num">{n}</span><span className="nc-step-title">{title}</span></div>
      {children}
    </div>
  );
}

function ImmediateStep({ slug, nc, canManage, onDone }: { slug: string; nc: NcDetail; canManage: boolean; onDone: () => void }) {
  const [val, setVal] = useState(nc.immediateAction ?? '');
  const [pending, start] = useTransition();
  return (
    <Step n={2} title="Action immédiate (curative)">
      {canManage ? (
        <>
          <textarea rows={2} value={val} onChange={(e) => setVal(e.target.value)} placeholder="Traiter le symptôme immédiatement…" style={{ width: '100%' }} />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} disabled={pending} onClick={() => start(async () => { await updateNcAction(slug, { ncId: nc.id, immediateAction: val.trim() || null }); onDone(); })}>Enregistrer</button>
        </>
      ) : <p className="ds-muted">{nc.immediateAction ?? '—'}</p>}
    </Step>
  );
}

function WhysStep({ slug, nc, whys, canManage, onDone }: { slug: string; nc: NcDetail; whys: { probleme: string; pourquoi: string[]; cause_racine: string }; canManage: boolean; onDone: () => void }) {
  const [problem, setProblem] = useState(whys.probleme);
  const [list, setList] = useState<string[]>(whys.pourquoi.length ? whys.pourquoi : ['']);
  const [root, setRoot] = useState(whys.cause_racine);
  const [pending, start] = useTransition();

  return (
    <Step n={3} title="Analyse de cause racine — 5 Pourquoi">
      {canManage ? (
        <>
          <input value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Problème constaté…" style={{ width: '100%', marginBottom: 8 }} />
          <div className="whys">
            {list.map((w, i) => (
              <div className="why-row" key={i}>
                <span className="why-n">Pourquoi {i + 1} ?</span>
                <input value={w} onChange={(e) => setList((s) => s.map((x, j) => (j === i ? e.target.value : x)))} style={{ flex: 1 }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {list.length < 6 ? <button className="btn btn-ghost btn-sm" onClick={() => setList((s) => [...s, ''])}>+ Pourquoi</button> : null}
          </div>
          <div className="root-cause" style={{ marginTop: 10 }}>
            <label className="field" style={{ margin: 0 }}>Cause racine<input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="La cause profonde identifiée…" /></label>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} disabled={pending} onClick={() => start(async () => { await updateNcAction(slug, { ncId: nc.id, problem: problem.trim() || null, whys: list.map((w) => w.trim()).filter(Boolean), rootCauseText: root.trim() || null }); onDone(); })}>Enregistrer l’analyse</button>
        </>
      ) : (
        <div className="whys">
          {whys.probleme ? <div className="ds-muted"><b>Problème :</b> {whys.probleme}</div> : null}
          {whys.pourquoi.map((w, i) => <div className="why-row" key={i}><span className="why-n">Pourquoi {i + 1}</span><span style={{ fontSize: 12.5 }}>{w}</span></div>)}
          {whys.cause_racine ? <div className="root-cause"><b>Cause racine :</b> {whys.cause_racine}</div> : null}
        </div>
      )}
    </Step>
  );
}

function AddCapa({ slug, ncId, onDone }: { slug: string; ncId: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [pending, start] = useTransition();
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <input placeholder="Nouvelle action corrective…" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
      <button className="btn btn-ghost btn-sm" disabled={pending || title.trim().length < 2} onClick={() => start(async () => { await createCorrectiveActionAction(slug, { ncId, title: title.trim() }); setTitle(''); onDone(); })}>Créer dans le plan d’action</button>
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
      const cost = String(fd.get('costEstimate') ?? '').trim();
      const res = await createNcAction(slug, { title: String(fd.get('title') ?? ''), description: String(fd.get('description') ?? '') || null, source: String(fd.get('source') ?? 'interne'), gravity: String(fd.get('gravity') ?? 'mineure'), processRef: String(fd.get('processRef') ?? '') || null, costEstimate: cost ? Number(cost) : null });
      if (res.ok) { router.refresh(); onCreated(res.data.id); } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Déclarer une non-conformité" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="Écarts d’étiquetage…" /></label>
        <label className="field">Description<textarea name="description" rows={2} /></label>
        <div className="risk-form-grid">
          <label className="field">Source<select name="source" defaultValue="interne">{Object.entries(SOURCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field">Gravité<select name="gravity" defaultValue="majeure">{Object.entries(GRAVITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field">Processus concerné<input name="processRef" placeholder="Réalisation · Expédition…" /></label>
          <label className="field">Coût NQ estimé (€)<input name="costEstimate" type="number" min="0" step="1" /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Déclaration…' : 'Déclarer'}</button></div>
      </form>
    </Dialog>
  );
}
