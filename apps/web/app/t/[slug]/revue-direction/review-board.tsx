'use client';

import type { AgendaSection, Tone } from '@toron/core';
import type { ExportSummary, ReviewDetail, ReviewSummary, TenantMember } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { frDate, initials, refCode } from '@/lib/format';

import {
  addDecisionAction,
  addParticipantAction,
  convertDecisionAction,
  createReviewAction,
  getReviewAction,
  removeParticipantAction,
  requestPvExportAction,
  setReviewStatusAction,
} from './review-actions';

const STATUS_LABEL: Record<string, string> = { planifie: 'Planifiée', tenue: 'Tenue', close: 'Close' };
const STATUSES = ['planifie', 'tenue', 'close'] as const;
const STATUS_CLASS: Record<string, string> = { planifie: 'ouverte', tenue: 'en_traitement', close: 'efficace' };
const TONE_CLASS: Record<Tone, string> = { ok: 'rv--ok', warn: 'rv--warn', danger: 'rv--danger', muted: 'rv--muted' };

export function ReviewBoard({
  slug,
  canManage,
  reviews,
  agenda,
  members,
  nextReviewDefault,
}: {
  slug: string;
  canManage: boolean;
  reviews: ReviewSummary[];
  agenda: AgendaSection[];
  members: TenantMember[];
  nextReviewDefault: string;
}) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="ds-toolbar">
        <span className="drawer-section-label" style={{ margin: 0 }}>Programme · {reviews.length}</span>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Programmer une revue</button> : null}
      </div>

      {reviews.length === 0 ? (
        <div className="empty-state"><h2>Aucune revue</h2><p>Programmez une revue de direction — l’ordre du jour se remplit depuis vos données.</p></div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 820 }}>
            <thead><tr><th style={{ width: 74 }}>ID</th><th style={{ minWidth: 240 }}>Revue</th><th style={{ width: 120 }}>Périmètre</th><th style={{ width: 96 }}>Séance</th><th style={{ width: 96 }}>Décisions</th><th style={{ width: 100 }}>Statut</th></tr></thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)}>
                  <td className="ds-id">{refCode('REV', r.id)}</td>
                  <td><div className="ds-primary">{r.title}<small>{r.participantCount} participant{r.participantCount > 1 ? 's' : ''}</small></div></td>
                  <td className="ds-muted">{r.scopeLabel}</td>
                  <td className="ds-mono">{frDate(r.heldAt)}</td>
                  <td className="ds-mono">{r.decisionCount}{r.actionCount > 0 ? <span style={{ color: 'var(--ok)' }}> · {r.actionCount} act.</span> : null}</td>
                  <td><span className={`nc-status ncs--${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? <CreateDialog slug={slug} nextReviewDefault={nextReviewDefault} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : null}
      {openId ? <ReviewDrawer slug={slug} reviewId={openId} canManage={canManage} agenda={agenda} members={members} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function AgendaView({ agenda }: { agenda: AgendaSection[] }) {
  return (
    <div className="drawer-section">
      <p className="drawer-section-label">Ordre du jour — auto-généré (clause 9.3)</p>
      {agenda.map((s) => (
        <div className="rv-sec" key={s.n}>
          <span className="rv-clause">{s.clause}</span>
          <p className="rv-sec-title">{s.n}. {s.title}</p>
          <p className="rv-summary">{s.summary}</p>
          {s.kind === 'kpi' && s.kpis.length > 0 ? (
            <div className="rv-kpis">
              {s.kpis.map((k) => (
                <div className="rv-kpi" key={k.label}>
                  <div className={`rv-kpi-val ${TONE_CLASS[k.tone]}`}>{k.value}</div>
                  <div className="rv-kpi-label">{k.label}</div>
                </div>
              ))}
            </div>
          ) : null}
          {s.bullets.length > 0 ? (
            <div className="rv-bullets">
              {s.bullets.map((b, i) => (
                <div className="rv-bullet" key={i}>
                  <span className={`rv-dot ${TONE_CLASS[b.tone]}`} /><b>{b.head}</b> {b.body}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ExportRow({ slug, exp }: { slug: string; exp: ExportSummary }) {
  const sealed = exp.status === 'scelle';
  const failed = exp.status === 'echec';
  return (
    <div className="export-row" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, padding: '4px 0' }}>
      <span className="export-label">Procès-verbal</span>
      {sealed ? (
        <>
          <a className="link-btn" href={`/t/${slug}/exports/${exp.id}/pdf`}>Télécharger le PDF scellé</a>
          {exp.verifySlug ? <a className="link-btn" href={`/verifier/${exp.verifySlug}`} target="_blank" rel="noreferrer">Vérifier le poinçon ↗</a> : null}
          {exp.sha256 ? <span className="ds-mono" title={exp.sha256} style={{ color: 'var(--text-2)' }}>{exp.sha256.slice(0, 12)}…</span> : null}
        </>
      ) : failed ? (
        <span style={{ color: 'var(--danger)' }}>Échec de génération</span>
      ) : (
        <span style={{ color: 'var(--text-2)' }}>Génération en cours…</span>
      )}
    </div>
  );
}

function ReviewDrawer({
  slug,
  reviewId,
  canManage,
  agenda,
  members,
  onClose,
}: {
  slug: string;
  reviewId: string;
  canManage: boolean;
  agenda: AgendaSection[];
  members: TenantMember[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [d, setD] = useState<ReviewDetail | null>(null);
  const [exports, setExports] = useState<ExportSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState('');
  const [pending, start] = useTransition();

  const reload = () => getReviewAction(slug, reviewId).then((r) => { if (r.ok) { setD(r.data.review); setExports(r.data.exports); } });
  useEffect(() => {
    let a = true;
    getReviewAction(slug, reviewId).then((r) => { if (a && r.ok) { setD(r.data.review); setExports(r.data.exports); } });
    return () => { a = false; };
  }, [slug, reviewId]);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => { const res = await fn(); if (res.ok) { await reload(); router.refresh(); } else setError(res.error?.message ?? 'Refusé.'); });
  }
  if (!d) return null;

  const participantIds = new Set(d.participants.map((p) => p.userId));
  const addable = members.filter((m) => !participantIds.has(m.userId));
  const generating = exports.some((e) => e.status === 'en_cours');

  const header = (
    <>
      <span className="ds-id" id="rev-title">{refCode('REV', d.id)}</span>
      <span className={`nc-status ncs--${STATUS_CLASS[d.status]}`}>{STATUS_LABEL[d.status]}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="rev-title" onClose={onClose}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{d.title}</h2>
      <div className="ds-muted" style={{ marginBottom: 12 }}>
        {d.scopeLabel} · séance {frDate(d.heldAt)}{d.nextReviewAt ? ` · prochaine ${frDate(d.nextReviewAt)}` : ''}
      </div>

      {canManage ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Statut</p>
          <div className="status-flow">
            {STATUSES.map((s) => <button key={s} className="btn btn-ghost btn-sm" aria-pressed={d.status === s} disabled={pending} onClick={() => run(() => setReviewStatusAction(slug, { reviewId: d.id, status: s }))}>{STATUS_LABEL[s]}</button>)}
          </div>
        </div>
      ) : null}

      <AgendaView agenda={agenda} />

      <div className="drawer-section">
        <p className="drawer-section-label">Participants · {d.participants.length}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {d.participants.map((p) => (
            <span key={p.userId} className="ds-owner" style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px 2px 2px' }}>
              <span className="ds-avatar">{initials(p.name)}</span><span>{p.name}</span>
              {canManage ? <button aria-label={`Retirer ${p.name}`} className="link-btn" style={{ marginLeft: 4 }} disabled={pending} onClick={() => run(() => removeParticipantAction(slug, { reviewId: d.id, userId: p.userId }))}>×</button> : null}
            </span>
          ))}
          {d.participants.length === 0 ? <span className="risk-mut-hint">Aucun participant.</span> : null}
        </div>
        {canManage && addable.length > 0 ? (
          <select defaultValue="" style={{ marginTop: 8 }} disabled={pending} onChange={(e) => { const v = e.target.value; if (v) run(() => addParticipantAction(slug, { reviewId: d.id, userId: v })); e.target.value = ''; }}>
            <option value="">+ Ajouter un participant…</option>
            {addable.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        ) : null}
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Décisions · {d.decisions.length}</p>
        {d.decisions.length === 0 ? <p className="risk-mut-hint">Aucune décision consignée.</p> : d.decisions.map((dec, i) => (
          <div className="nc-step" key={dec.id} style={{ padding: 10 }}>
            <div style={{ fontSize: 12.5 }}><b>D{i + 1}.</b> {dec.body}</div>
            {dec.actionId ? (
              <span className="ds-id" style={{ color: 'var(--ok)' }}>→ action tracée</span>
            ) : canManage ? (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} disabled={pending} onClick={() => run(() => convertDecisionAction(slug, { reviewId: d.id, decisionId: dec.id, title: dec.body.slice(0, 120) }))}>Convertir en action</button>
            ) : null}
          </div>
        ))}
        {canManage ? (
          <div style={{ marginTop: 8 }}>
            <label className="field">Nouvelle décision<textarea rows={2} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Décision prise en séance…" /></label>
            <button className="btn btn-primary btn-sm" disabled={pending || decision.trim().length < 2} onClick={() => run(async () => { const r = await addDecisionAction(slug, { reviewId: d.id, body: decision.trim() }); if (r.ok) setDecision(''); return r; })}>Ajouter la décision</button>
          </div>
        ) : null}
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Procès-verbal scellé · poinçon</p>
        {exports.map((e) => <ExportRow key={e.id} slug={slug} exp={e} />)}
        {canManage ? (
          <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={pending || generating} onClick={() => run(() => requestPvExportAction(slug, { reviewId: d.id }))}>
            {generating ? 'Génération en cours…' : 'Générer le procès-verbal'}
          </button>
        ) : null}
        {generating ? <button className="link-btn" style={{ marginLeft: 8 }} onClick={() => reload()}>Actualiser</button> : null}
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}

function CreateDialog({ slug, nextReviewDefault, onClose, onCreated }: { slug: string; nextReviewDefault: string; onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createReviewAction(slug, {
        title: String(fd.get('title') ?? ''),
        heldAt: String(fd.get('heldAt') ?? '') || null,
        nextReviewAt: String(fd.get('nextReviewAt') ?? '') || null,
      });
      if (res.ok) { router.refresh(); onCreated(res.data.id); } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Programmer une revue de direction" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="Revue de direction — S2 2026" /></label>
        <div className="risk-form-grid">
          <label className="field">Date de séance<input type="date" name="heldAt" /></label>
          <label className="field">Prochaine revue<input type="date" name="nextReviewAt" defaultValue={nextReviewDefault} /></label>
        </div>
        <p className="risk-mut-hint">Une seule revue couvre le SMSI et le QMS (clause 9.3). L’ordre du jour se remplira automatiquement depuis vos données.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Programmer'}</button></div>
      </form>
    </Dialog>
  );
}
