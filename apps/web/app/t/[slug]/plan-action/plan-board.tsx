'use client';

import { KANBAN_COLUMNS, type ActionEffectiveStatus, type ActionStatus } from '@toron/core';
import type { ActionDetail, ActionSummary, TenantMember } from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

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
  risk: 'Risque',
  assessment: 'Écart',
  nc: 'NC',
  finding: 'Constat',
  incident: 'Incident',
  review: 'Revue',
  manual: 'Manuel',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function PlanBoard({
  slug,
  canManage,
  actions,
  members,
}: {
  slug: string;
  canManage: boolean;
  actions: ActionSummary[];
  members: TenantMember[];
}) {
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ActionSummary | null>(null);

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const c = new Set(s);
      if (c.has(id)) c.delete(id);
      else c.add(id);
      return c;
    });

  return (
    <>
      <div className="plan-toolbar">
        <div className="view-toggle" role="group" aria-label="Affichage">
          <button aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          <button aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}>Kanban</button>
        </div>
        <span className="spacer" />
        {canManage ? (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouvelle action</button>
        ) : null}
      </div>

      {view === 'table' ? (
        <TableView
          actions={actions}
          canManage={canManage}
          selected={selected}
          onToggleSel={toggleSel}
          onOpen={setEditing}
        />
      ) : (
        <KanbanView actions={actions} onOpen={setEditing} />
      )}

      {canManage && selected.size > 0 ? (
        <BulkBar
          slug={slug}
          count={selected.size}
          ids={[...selected]}
          onDone={() => setSelected(new Set())}
        />
      ) : null}

      {creating ? (
        <ActionDialog slug={slug} members={members} action={null} canManage={canManage} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <ActionDialog slug={slug} members={members} action={editing} canManage={canManage} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function StatusTag({ status }: { status: ActionEffectiveStatus }) {
  return <span className={`status-tag st--${status}`}>{STATUS_LABEL[status]}</span>;
}

function TableView({
  actions,
  canManage,
  selected,
  onToggleSel,
  onOpen,
}: {
  actions: ActionSummary[];
  canManage: boolean;
  selected: Set<string>;
  onToggleSel: (id: string) => void;
  onOpen: (a: ActionSummary) => void;
}) {
  if (actions.length === 0) {
    return <div className="empty-state"><h2>Aucune action</h2><p>Créez une action ou convertissez un écart d’évaluation.</p></div>;
  }
  return (
    <div className="card plan-table-card">
      <div className="plan-table-wrap">
        <table className="plan-table">
          <thead>
            <tr>
              {canManage ? <th className="plan-check"></th> : null}
              <th>Action</th>
              <th>Origine</th>
              <th>Prio</th>
              <th>Propriétaire</th>
              <th>Échéance</th>
              <th>Avancement</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                {canManage ? (
                  <td className="plan-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => onToggleSel(a.id)} aria-label={`Sélectionner ${a.title}`} />
                  </td>
                ) : null}
                <td className="plan-title-cell" onClick={() => onOpen(a)}>{a.title}</td>
                <td><span className="origin-tag">{ORIGIN_LABEL[a.originType] ?? a.originType}</span></td>
                <td><span className={`prio prio--${a.priority}`}>{PRIORITY_LABEL[a.priority]}</span></td>
                <td>{a.ownerName ?? '—'}</td>
                <td className={`mono ${a.effectiveStatus === 'en_retard' ? 'due-late' : ''}`} style={{ fontSize: 12 }}>{fmtDate(a.dueDate)}</td>
                <td>{a.subtaskTotal > 0 ? `${a.subtaskDone}/${a.subtaskTotal}` : '—'}</td>
                <td><StatusTag status={a.effectiveStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KanbanView({ actions, onOpen }: { actions: ActionSummary[]; onOpen: (a: ActionSummary) => void }) {
  return (
    <div className="kanban">
      {KANBAN_COLUMNS.map((col) => {
        const items = actions.filter((a) => a.effectiveStatus === col);
        return (
          <div className="kanban-col" key={col}>
            <div className="kanban-col-head">
              <StatusTag status={col} />
              <span className="kanban-col-count">{items.length}</span>
            </div>
            {items.map((a) => (
              <div className={`action-card st--${a.effectiveStatus}`} key={a.id} onClick={() => onOpen(a)}>
                <div className="action-card-title">{a.title}</div>
                <div className="action-card-meta">
                  <span className={`prio prio--${a.priority}`}>{PRIORITY_LABEL[a.priority]}</span>
                  <span className="origin-tag">{ORIGIN_LABEL[a.originType] ?? a.originType}</span>
                </div>
                <div className="action-card-foot">
                  <span>{a.ownerName ?? 'Non attribuée'}</span>
                  {a.subtaskTotal > 0 ? (
                    <span className="mini-progress" title={`${a.subtaskDone}/${a.subtaskTotal}`}>
                      <span style={{ width: `${Math.round((a.subtaskDone / a.subtaskTotal) * 100)}%` }} />
                    </span>
                  ) : null}
                  <span className="mono">{fmtDate(a.dueDate)}</span>
                </div>
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
    start(async () => {
      const res = await bulkStatusAction(slug, { actionIds: ids, status, justification });
      if (res.ok) {
        onDone();
        router.refresh();
      } else setError(res.error.message);
    });
  }

  return (
    <div className="bulk-bar">
      <b>{count} sélectionnée{count > 1 ? 's' : ''}</b>
      <select value={status} onChange={(e) => setStatus(e.target.value as ActionStatus)} aria-label="Nouveau statut">
        {STORED_STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </select>
      <input
        placeholder="Justification (obligatoire)"
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        style={{ flex: 1, minWidth: 160 }}
      />
      <button className="btn btn-primary btn-sm" disabled={pending || justification.trim().length < 5} onClick={apply}>
        {pending ? 'Application…' : 'Appliquer'}
      </button>
      {error ? <span className="form-error" style={{ margin: 0 }}>{error}</span> : null}
    </div>
  );
}

function ActionDialog({
  slug,
  members,
  action,
  canManage,
  onClose,
}: {
  slug: string;
  members: TenantMember[];
  action: ActionSummary | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = action !== null;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [detail, setDetail] = useState<ActionDetail | null>(null);

  useEffect(() => {
    if (!action) return;
    let alive = true;
    getActionDetailAction(slug, action.id).then((res) => {
      if (alive && res.ok) setDetail(res.data);
    });
    return () => {
      alive = false;
    };
  }, [slug, action]);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>, close = false, refreshDetail = false) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        router.refresh();
        if (close) onClose();
        if (refreshDetail && action) {
          const d = await getActionDetailAction(slug, action.id);
          if (d.ok) setDetail(d.data);
        }
      } else setError(res.error?.message ?? 'Action refusée.');
    });
  }

  function submit(fd: FormData) {
    const payload = {
      title: String(fd.get('title') ?? ''),
      description: String(fd.get('description') ?? '') || null,
      ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
      dueDate: String(fd.get('dueDate') ?? '') || null,
      priority: String(fd.get('priority') ?? 'p2'),
    };
    if (isEdit) run(() => updateActionAction(slug, { actionId: action!.id, ...payload }));
    else run(() => createActionAction(slug, { ...payload, originType: 'manual' }), true);
  }

  return (
    <Dialog title={isEdit ? 'Fiche action' : 'Nouvelle action'} onClose={onClose}>
      <form action={submit}>
        <label className="field">
          Intitulé
          <input name="title" defaultValue={action?.title ?? ''} minLength={2} required disabled={!canManage} />
        </label>
        <label className="field">
          Description
          <textarea name="description" defaultValue={action?.description ?? ''} rows={2} disabled={!canManage} />
        </label>
        <div className="risk-form-grid">
          <label className="field">
            Propriétaire
            <select name="ownerUserId" defaultValue={action?.ownerUserId ?? ''} disabled={!canManage}>
              <option value="">— Non attribuée —</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </select>
          </label>
          <label className="field">
            Priorité
            <select name="priority" defaultValue={action?.priority ?? 'p2'} disabled={!canManage}>
              <option value="p1">P1 — haute</option>
              <option value="p2">P2 — moyenne</option>
              <option value="p3">P3 — basse</option>
            </select>
          </label>
          <label className="field">
            Échéance
            <input type="date" name="dueDate" defaultValue={action?.dueDate?.slice(0, 10) ?? ''} disabled={!canManage} />
          </label>
          {isEdit ? (
            <div className="field">
              Origine
              <div style={{ paddingTop: 6 }}><span className="origin-tag">{ORIGIN_LABEL[action!.originType] ?? action!.originType}</span></div>
            </div>
          ) : null}
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {canManage ? (
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              {pending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer l’action'}
            </button>
          </div>
        ) : null}
      </form>

      {isEdit ? (
        <>
          {/* Flux de statut */}
          <div style={{ marginTop: 16 }}>
            <p className="rating-block-title">Statut</p>
            <div className="status-flow">
              {STORED_STATUSES.map((s) => (
                <button
                  key={s}
                  className={`btn btn-ghost btn-sm st--${s}`}
                  aria-pressed={action!.status === s}
                  disabled={!canManage || pending}
                  onClick={() => run(() => setActionStatusAction(slug, { actionId: action!.id, status: s }))}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Liaisons origine / exigences */}
          {detail && detail.links.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <p className="rating-block-title">Exigences & contrôles liés</p>
              <div className="action-links-row">
                {detail.links.map((l) => (
                  <span className="chip-ref" key={`${l.targetType}-${l.targetId}`}>{l.label}</span>
                ))}
              </div>
            </div>
          ) : null}

          <Subtasks slug={slug} actionId={action!.id} detail={detail} canManage={canManage} onChanged={() => run(async () => ({ ok: true }), false, true)} />
          <Comments slug={slug} actionId={action!.id} detail={detail} canManage={canManage} onChanged={() => run(async () => ({ ok: true }), false, true)} />
        </>
      ) : null}
    </Dialog>
  );
}

function Subtasks({
  slug,
  actionId,
  detail,
  canManage,
  onChanged,
}: {
  slug: string;
  actionId: string;
  detail: ActionDetail | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState('');
  const [pending, start] = useTransition();

  return (
    <div style={{ marginTop: 16 }}>
      <p className="rating-block-title">Sous-tâches</p>
      {detail === null ? (
        <p className="risk-mut-hint">Chargement…</p>
      ) : (
        <div className="action-subtasks">
          {detail.subtasks.map((s) => (
            <div className={`subtask-row${s.done ? ' done' : ''}`} key={s.id}>
              <input
                type="checkbox"
                checked={s.done}
                disabled={!canManage || pending}
                onChange={(e) => start(async () => {
                  await toggleSubtaskAction(slug, { subtaskId: s.id, done: e.target.checked });
                  onChanged();
                })}
              />
              <label>{s.title}</label>
            </div>
          ))}
          {detail.subtasks.length === 0 ? <p className="risk-mut-hint">Aucune sous-tâche.</p> : null}
        </div>
      )}
      {canManage ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input placeholder="Ajouter une sous-tâche…" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
          <button
            className="btn btn-ghost btn-sm"
            disabled={pending || title.trim().length === 0}
            onClick={() => start(async () => {
              await addSubtaskAction(slug, { actionId, title: title.trim() });
              setTitle('');
              onChanged();
            })}
          >
            Ajouter
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Comments({
  slug,
  actionId,
  detail,
  canManage,
  onChanged,
}: {
  slug: string;
  actionId: string;
  detail: ActionDetail | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();

  return (
    <div style={{ marginTop: 16 }}>
      <p className="rating-block-title">Commentaires</p>
      {detail === null ? (
        <p className="risk-mut-hint">Chargement…</p>
      ) : (
        <div className="comment-thread">
          {detail.comments.map((c) => (
            <div className="comment" key={c.id}>
              <div className="comment-head">
                <span>{c.authorName ?? 'Utilisateur'}</span>
                <span>{new Date(c.createdAt).toLocaleDateString('fr-FR')}</span>
              </div>
              {c.body}
            </div>
          ))}
          {detail.comments.length === 0 ? <p className="risk-mut-hint">Aucun commentaire.</p> : null}
        </div>
      )}
      {canManage ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input placeholder="Ajouter un commentaire…" value={body} onChange={(e) => setBody(e.target.value)} style={{ flex: 1 }} />
          <button
            className="btn btn-ghost btn-sm"
            disabled={pending || body.trim().length === 0}
            onClick={() => start(async () => {
              await addCommentAction(slug, { actionId, body: body.trim() });
              setBody('');
              onChanged();
            })}
          >
            Publier
          </button>
        </div>
      ) : null}
    </div>
  );
}
