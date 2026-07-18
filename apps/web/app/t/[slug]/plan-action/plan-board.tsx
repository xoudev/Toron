'use client';

import { KANBAN_COLUMNS, type ActionEffectiveStatus, type ActionStatus } from '@toron/core';
import type { ActionDetail, ActionSummary, TenantMember } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';

import {
  addCommentAction,
  addSubtaskAction,
  bulkStatusAction,
  createActionAction,
  getActionDetailAction,
  setActionStatusAction,
  toggleSubtaskAction,
  updateActionAction,
} from './action-actions';

const STATUS_LABEL: Record<ActionEffectiveStatus, string> = {
  planifie: 'Planifiée',
  en_cours: 'En cours',
  en_retard: 'En retard',
  verification: 'Vérification',
  termine: 'Terminée',
};
const STORED_STATUSES: ActionStatus[] = ['planifie', 'en_cours', 'verification', 'termine'];
const PRIORITY_LABEL: Record<string, string> = { p1: 'P1', p2: 'P2', p3: 'P3' };
const ORIGIN_LABEL: Record<string, string> = {
  risk: 'Risque', assessment: 'Écart', nc: 'NC', finding: 'Constat', incident: 'Incident', review: 'Revue', manual: 'Manuel',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
function StatusTag({ status }: { status: ActionEffectiveStatus }) {
  return <span className={`status-tag st--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function PlanBoard({ slug, canManage, actions, members }: { slug: string; canManage: boolean; actions: ActionSummary[]; members: TenantMember[] }) {
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const toggleSel = (id: string) => setSelected((s) => { const c = new Set(s); if (c.has(id)) c.delete(id); else c.add(id); return c; });
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.title.toLowerCase().includes(q) || refCode('ACT', a.id).toLowerCase().includes(q));
  }, [actions, query]);
  const open = openId ? actions.find((a) => a.id === openId) ?? null : null;

  return (
    <>
      <div className="ds-toolbar">
        <div className="ds-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 20.5 20.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher — ACT-142, intitulé" />
        </div>
        <div className="view-toggle" role="group" aria-label="Affichage">
          <button aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          <button aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}>Kanban</button>
        </div>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouvelle action</button> : null}
      </div>

      {view === 'table' ? (
        <TableView actions={shown} canManage={canManage} selected={selected} onToggleSel={toggleSel} onOpen={setOpenId} />
      ) : (
        <KanbanView actions={shown} onOpen={setOpenId} />
      )}

      {canManage && selected.size > 0 ? (
        <BulkBar slug={slug} count={selected.size} ids={[...selected]} onDone={() => setSelected(new Set())} />
      ) : null}

      {creating ? <ActionCreateDialog slug={slug} members={members} onClose={() => setCreating(false)} /> : null}
      {open ? <ActionDrawer slug={slug} members={members} action={open} canManage={canManage} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function TableView({ actions, canManage, selected, onToggleSel, onOpen }: { actions: ActionSummary[]; canManage: boolean; selected: Set<string>; onToggleSel: (id: string) => void; onOpen: (id: string) => void }) {
  if (actions.length === 0) {
    return <div className="empty-state"><h2>Aucune action</h2><p>Elles naîtront de vos évaluations, audits et incidents — ou créez-en une.</p></div>;
  }
  return (
    <div className="ds-table-card">
      <div className="ds-scroll">
        <table className="ds-table" style={{ minWidth: 940 }}>
          <thead>
            <tr>
              {canManage ? <th style={{ width: 34 }}></th> : null}
              <th style={{ width: 74 }}>ID</th>
              <th style={{ minWidth: 260 }}>Action</th>
              <th style={{ width: 92 }}>Origine</th>
              <th style={{ width: 54 }}>Prio</th>
              <th style={{ width: 150 }}>Propriétaire</th>
              <th style={{ width: 92 }}>Échéance</th>
              <th style={{ width: 96 }}>Avancement</th>
              <th style={{ width: 118 }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id} onClick={() => onOpen(a.id)}>
                {canManage ? <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(a.id)} onChange={() => onToggleSel(a.id)} aria-label={`Sélectionner ${a.title}`} /></td> : null}
                <td className="ds-id">{refCode('ACT', a.id)}</td>
                <td><div className="ds-primary">{a.title}</div></td>
                <td><span className="ds-chip">{ORIGIN_LABEL[a.originType] ?? a.originType}</span></td>
                <td><span className={`prio prio--${a.priority}`}>{PRIORITY_LABEL[a.priority]}</span></td>
                <td><div className="ds-owner"><span className="ds-avatar" title={a.ownerName ?? undefined}>{initials(a.ownerName)}</span><span>{a.ownerName ?? '—'}</span></div></td>
                <td className="ds-mono" style={{ color: a.effectiveStatus === 'en_retard' ? 'var(--danger)' : undefined, fontWeight: a.effectiveStatus === 'en_retard' ? 600 : undefined }}>{fmtDate(a.dueDate)}</td>
                <td className="ds-mono">{a.subtaskTotal > 0 ? `${a.subtaskDone}/${a.subtaskTotal}` : '—'}</td>
                <td><StatusTag status={a.effectiveStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KanbanView({ actions, onOpen }: { actions: ActionSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className="kanban">
      {KANBAN_COLUMNS.map((col) => {
        const items = actions.filter((a) => a.effectiveStatus === col);
        return (
          <div className="kanban-col" key={col}>
            <div className="kanban-col-head"><StatusTag status={col} /><span className="kanban-col-count">{items.length}</span></div>
            {items.map((a) => (
              <div className={`action-card st--${a.effectiveStatus}`} key={a.id} onClick={() => onOpen(a.id)}>
                <div className="action-card-title">{a.title}</div>
                <div className="action-card-meta"><span className="ds-id">{refCode('ACT', a.id)}</span><span className={`prio prio--${a.priority}`}>{PRIORITY_LABEL[a.priority]}</span><span className="origin-tag">{ORIGIN_LABEL[a.originType] ?? a.originType}</span></div>
                <div className="action-card-foot"><span className="ds-avatar" title={a.ownerName ?? undefined}>{initials(a.ownerName)}</span>{a.subtaskTotal > 0 ? <span className="mini-progress" title={`${a.subtaskDone}/${a.subtaskTotal}`}><span style={{ width: `${Math.round((a.subtaskDone / a.subtaskTotal) * 100)}%` }} /></span> : null}<span className="ds-mono">{fmtDate(a.dueDate)}</span></div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function BulkBar({ slug, count, ids, onDone }: { slug: string; count: number; ids: string[]; onDone: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<ActionStatus>('en_cours');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function apply() {
    setError(null);
    start(async () => { const res = await bulkStatusAction(slug, { actionIds: ids, status, justification }); if (res.ok) { onDone(); router.refresh(); } else setError(res.error.message); });
  }
  return (
    <div className="bulk-bar">
      <b>{count} sélectionnée{count > 1 ? 's' : ''}</b>
      <select value={status} onChange={(e) => setStatus(e.target.value as ActionStatus)} aria-label="Nouveau statut">{STORED_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      <input placeholder="Justification (obligatoire)" value={justification} onChange={(e) => setJustification(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
      <button className="btn btn-primary btn-sm" disabled={pending || justification.trim().length < 5} onClick={apply}>{pending ? 'Application…' : 'Appliquer'}</button>
      {error ? <span className="form-error" style={{ margin: 0 }}>{error}</span> : null}
    </div>
  );
}

function ActionCreateDialog({ slug, members, onClose }: { slug: string; members: TenantMember[]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createActionAction(slug, { title: String(fd.get('title') ?? ''), description: String(fd.get('description') ?? '') || null, ownerUserId: String(fd.get('ownerUserId') ?? '') || null, dueDate: String(fd.get('dueDate') ?? '') || null, priority: String(fd.get('priority') ?? 'p2'), originType: 'manual' });
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Nouvelle action" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="Corriger l’écart…" /></label>
        <label className="field">Description<textarea name="description" rows={2} /></label>
        <div className="risk-form-grid">
          <label className="field">Propriétaire<select name="ownerUserId" defaultValue=""><option value="">— Non attribuée —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          <label className="field">Priorité<select name="priority" defaultValue="p2"><option value="p1">P1 — haute</option><option value="p2">P2 — moyenne</option><option value="p3">P3 — basse</option></select></label>
          <label className="field">Échéance<input type="date" name="dueDate" /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Créer l’action'}</button></div>
      </form>
    </Dialog>
  );
}

function ActionDrawer({ slug, members, action, canManage, onClose }: { slug: string; members: TenantMember[]; action: ActionSummary; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [detail, setDetail] = useState<ActionDetail | null>(null);

  useEffect(() => {
    let alive = true;
    getActionDetailAction(slug, action.id).then((res) => { if (alive && res.ok) setDetail(res.data); });
    return () => { alive = false; };
  }, [slug, action.id]);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>, refreshDetail = false) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { router.refresh(); if (refreshDetail) { const d = await getActionDetailAction(slug, action.id); if (d.ok) setDetail(d.data); } }
      else setError(res.error?.message ?? 'Action refusée.');
    });
  }
  function saveDetails(fd: FormData) {
    run(() => updateActionAction(slug, { actionId: action.id, title: String(fd.get('title') ?? ''), description: String(fd.get('description') ?? '') || null, ownerUserId: String(fd.get('ownerUserId') ?? '') || null, dueDate: String(fd.get('dueDate') ?? '') || null, priority: String(fd.get('priority') ?? 'p2') }));
  }

  const header = (
    <>
      <span className="ds-id" id="act-drawer-title">{refCode('ACT', action.id)}</span>
      <StatusTag status={action.effectiveStatus} />
      <span className="ds-chip">{ORIGIN_LABEL[action.originType] ?? action.originType}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="act-drawer-title" onClose={onClose}>
      <form action={saveDetails} className="drawer-section">
        <label className="field">Intitulé<input name="title" defaultValue={action.title} minLength={2} required disabled={!canManage} /></label>
        <label className="field">Description<textarea name="description" defaultValue={action.description ?? ''} rows={2} disabled={!canManage} /></label>
        <div className="risk-form-grid">
          <label className="field">Propriétaire<select name="ownerUserId" defaultValue={action.ownerUserId ?? ''} disabled={!canManage}><option value="">— Non attribuée —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          <label className="field">Priorité<select name="priority" defaultValue={action.priority} disabled={!canManage}><option value="p1">P1 — haute</option><option value="p2">P2 — moyenne</option><option value="p3">P3 — basse</option></select></label>
          <label className="field">Échéance<input type="date" name="dueDate" defaultValue={action.dueDate?.slice(0, 10) ?? ''} disabled={!canManage} /></label>
        </div>
        {canManage ? <button type="submit" className="btn btn-ghost btn-sm" disabled={pending} style={{ marginTop: 8 }}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button> : null}
      </form>

      <div className="drawer-section">
        <p className="drawer-section-label">Statut</p>
        <div className="status-flow">
          {STORED_STATUSES.map((s) => (
            <button key={s} className={`btn btn-ghost btn-sm st--${s}`} aria-pressed={action.status === s} disabled={!canManage || pending} onClick={() => run(() => setActionStatusAction(slug, { actionId: action.id, status: s }))}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>

      {detail && detail.links.length > 0 ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Exigences & contrôles liés</p>
          <div className="ds-refchips" style={{ gap: 6 }}>{detail.links.map((l) => <span className="ds-refchip" key={`${l.targetType}-${l.targetId}`}><span className="dot" />{l.label}</span>)}</div>
        </div>
      ) : null}

      <Subtasks slug={slug} actionId={action.id} detail={detail} canManage={canManage} onChanged={() => run(async () => ({ ok: true }), true)} />
      <Comments slug={slug} actionId={action.id} detail={detail} canManage={canManage} onChanged={() => run(async () => ({ ok: true }), true)} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}

function Subtasks({ slug, actionId, detail, canManage, onChanged }: { slug: string; actionId: string; detail: ActionDetail | null; canManage: boolean; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="drawer-section">
      <p className="drawer-section-label">Sous-tâches</p>
      {detail === null ? <p className="risk-mut-hint">Chargement…</p> : (
        <div className="action-subtasks">
          {detail.subtasks.map((s) => (
            <div className={`subtask-row${s.done ? ' done' : ''}`} key={s.id}>
              <input type="checkbox" checked={s.done} disabled={!canManage || pending} onChange={(e) => start(async () => { await toggleSubtaskAction(slug, { subtaskId: s.id, done: e.target.checked }); onChanged(); })} />
              <label>{s.title}</label>
            </div>
          ))}
          {detail.subtasks.length === 0 ? <p className="risk-mut-hint">Aucune sous-tâche.</p> : null}
        </div>
      )}
      {canManage ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input placeholder="Ajouter une sous-tâche…" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" disabled={pending || title.trim().length === 0} onClick={() => start(async () => { await addSubtaskAction(slug, { actionId, title: title.trim() }); setTitle(''); onChanged(); })}>Ajouter</button>
        </div>
      ) : null}
    </div>
  );
}

function Comments({ slug, actionId, detail, canManage, onChanged }: { slug: string; actionId: string; detail: ActionDetail | null; canManage: boolean; onChanged: () => void }) {
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="drawer-section">
      <p className="drawer-section-label">Commentaires</p>
      {detail === null ? <p className="risk-mut-hint">Chargement…</p> : (
        <div className="comment-thread">
          {detail.comments.map((c) => (
            <div className="comment" key={c.id}><div className="comment-head"><span>{c.authorName ?? 'Utilisateur'}</span><span>{new Date(c.createdAt).toLocaleDateString('fr-FR')}</span></div>{c.body}</div>
          ))}
          {detail.comments.length === 0 ? <p className="risk-mut-hint">Aucun commentaire.</p> : null}
        </div>
      )}
      {canManage ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input placeholder="Ajouter un commentaire…" value={body} onChange={(e) => setBody(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" disabled={pending || body.trim().length === 0} onClick={() => start(async () => { await addCommentAction(slug, { actionId, body: body.trim() }); setBody(''); onChanged(); })}>Publier</button>
        </div>
      ) : null}
    </div>
  );
}
