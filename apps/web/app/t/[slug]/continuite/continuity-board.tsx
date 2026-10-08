'use client';

import {
  ACTIVITY_CONTINUITY_STATE_LABEL,
  CRITICALITY_LABEL,
  CRITICALITY_LEVELS,
  EXERCISE_KINDS,
  EXERCISE_KIND_LABEL,
  EXERCISE_RESULTS,
  EXERCISE_RESULT_LABEL,
  activityError,
  addDaysIso,
  exerciseError,
  foldForSearch,
  searchTerms,
  type ExerciseKind,
  type ExerciseResult,
  type ExerciseStatus,
} from '@toron/core';
import type { ContinuityActivityRow, ContinuityExerciseRow, TenantMember } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type KeyboardEvent } from 'react';

import { frDate } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { useOpenItem } from '@/lib/use-open-item';

import { createEvidenceAction } from '../preuves/evidence-actions';
import {
  attachExerciseReportAction,
  createContinuityActivityAction,
  createContinuityExerciseAction,
  deleteContinuityActivityAction,
  deleteContinuityExerciseAction,
  planExerciseActionAction,
  updateContinuityActivityAction,
  updateContinuityExerciseAction,
} from './continuity-actions';

type Lite = { id: string; label: string };

/** Durée en heures, en clair : « 8 h », « 5 j », « immédiate ». */
export function hours(h: number): string {
  if (h === 0) return 'immédiate';
  return h >= 48 && h % 24 === 0 ? `${h / 24} j` : `${h} h`;
}

function minutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')}`;
}

const EXERCISE_STATUS_LABEL: Record<ExerciseStatus, string> = { planifie: 'Planifié', realise: 'Réalisé', annule: 'Annulé' };

function exerciseOutcome(e: ContinuityExerciseRow): { label: string; tone: string } {
  if (e.status === 'planifie') return { label: 'Planifié', tone: 'planifie' };
  if (e.status === 'annule') return { label: 'Annulé', tone: 'annule' };
  return { label: EXERCISE_RESULT_LABEL[e.result!], tone: e.result! };
}

function onEnter(e: KeyboardEvent<HTMLTableRowElement>, open: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open();
  }
}

type Tab = 'activites' | 'exercices';

export function ContinuityBoard({ slug, today, userId, canManage, activities, exercises, members, processes, documents, assets, suppliers, evidences }: {
  slug: string; today: string; userId: string; canManage: boolean; activities: ContinuityActivityRow[]; exercises: ContinuityExerciseRow[];
  members: TenantMember[]; processes: Lite[] | null; documents: Lite[]; assets: Lite[]; suppliers: Lite[] | null; evidences: Lite[];
}) {
  const [openId, setOpenId] = useOpenItem([...activities.map((a) => a.id), ...exercises.map((e) => e.id)]);
  const [tab, setTab] = useState<Tab>(exercises.some((e) => e.id === openId) ? 'exercices' : 'activites');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<'activite' | { exercise: Partial<ExerciseInitial> } | null>(null);
  const openActivity = activities.find((a) => a.id === openId) ?? null;
  const openExercise = exercises.find((e) => e.id === openId) ?? null;
  const terms = searchTerms(query);
  const match = (text: string) => terms.length === 0 || terms.every((t) => foldForSearch(text).includes(t));

  const shownActivities = activities.filter((a) => match([a.name, a.processName, a.ownerName, ...a.assets.map((x) => x.name), ...a.suppliers.map((x) => x.name)].filter(Boolean).join(' ')));
  const shownExercises = exercises.filter((e) => match([e.title, EXERCISE_KIND_LABEL[e.kind], e.leadName, ...e.activities.map((x) => x.name)].filter(Boolean).join(' ')));

  function planExercise(activityId?: string) {
    setOpenId(null);
    setTab('exercices');
    setCreating({ exercise: { activityIds: activityId ? [activityId] : [], scheduledOn: addDaysIso(today, 30) } });
  }

  return (
    <>
      <div className="ds-toolbar">
        <div className="view-toggle" role="group" aria-label="Registre affiché">
          <button type="button" aria-pressed={tab === 'activites'} onClick={() => setTab('activites')}>Activités critiques · {activities.length}</button>
          <button type="button" aria-pressed={tab === 'exercices'} onClick={() => setTab('exercices')}>Exercices et tests · {exercises.length}</button>
        </div>
        <div className="ds-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 20.5 20.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'activites' ? 'Rechercher une activité, un actif, un fournisseur' : 'Rechercher un exercice, une activité, un pilote'} aria-label="Rechercher" />
        </div>
        <span className="spacer" />
        {canManage ? (
          tab === 'activites'
            ? <button className="btn btn-primary btn-sm" onClick={() => setCreating('activite')}>+ Nouvelle activité</button>
            : <button className="btn btn-primary btn-sm" onClick={() => planExercise()}>+ Planifier un exercice</button>
        ) : null}
      </div>

      {tab === 'activites' ? (
        activities.length === 0 ? (
          <div className="empty-state">
            <h2>Aucune activité critique</h2>
            <p>
              Commencez par le bilan d’impact : les activités dont l’arrêt menace l’entreprise, la durée d’interruption
              qu’elles supportent (DMIA), les données qu’elles peuvent perdre (PDMA), et ce dont elles dépendent.
            </p>
          </div>
        ) : (
          <div className="ds-table-card"><div className="ds-scroll">
            <table className="ds-table bcp-table" style={{ minWidth: 960 }}>
              <thead><tr>
                <th style={{ minWidth: 280 }}>Activité</th><th style={{ width: 100 }}>Criticité</th><th style={{ width: 80 }}>DMIA</th>
                <th style={{ width: 80 }}>PDMA</th><th style={{ width: 170 }}>Dépendances</th><th style={{ width: 170 }}>Dernier exercice</th><th style={{ width: 150 }}>État</th>
              </tr></thead>
              <tbody>
                {shownActivities.length === 0 ? <tr><td colSpan={7} className="ds-empty">Aucune activité ne correspond.</td></tr> : shownActivities.map((a) => (
                  <tr key={a.id} tabIndex={0} onClick={() => setOpenId(a.id)} onKeyDown={(e) => onEnter(e, () => setOpenId(a.id))}>
                    <td><div className="ds-primary">{a.name}<small>{[a.processName, a.ownerName].filter(Boolean).join(' · ') || 'Sans responsable'}</small></div></td>
                    <td><span className={`bcp-crit bcp-crit--${a.criticality}`}>{CRITICALITY_LABEL[a.criticality]}</span></td>
                    <td className="bcp-num">{hours(a.rtoHours)}</td>
                    <td className="bcp-num">{hours(a.rpoHours)}</td>
                    <td className="bcp-deps">{dependencies(a)}</td>
                    <td>
                      {a.lastExercise ? <><span className="bcp-num">{frDate(a.lastExercise.heldOn)}</span><small className="bcp-sub">{EXERCISE_RESULT_LABEL[a.lastExercise.result]}</small></> : <span className="ds-muted">Aucun</span>}
                      {a.nextExerciseOn ? <small className="bcp-sub">Prochain le {frDate(a.nextExerciseOn)}</small> : null}
                    </td>
                    <td>
                      <span className={`bcp-state bcp-state--${a.state}`}>{ACTIVITY_CONTINUITY_STATE_LABEL[a.state]}</span>
                      {a.biaDueOn < today ? <small className="bcp-sub bcp-sub--warn">Bilan d’impact à revoir</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )
      ) : exercises.length === 0 ? (
        <div className="empty-state">
          <h2>Aucun exercice</h2>
          <p>
            Un plan non testé ne prouve rien : planifiez un test de restauration, une bascule ou un exercice sur table,
            puis consignez la durée de reprise mesurée et les enseignements.
          </p>
        </div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table bcp-table" style={{ minWidth: 960 }}>
            <thead><tr>
              <th style={{ width: 104 }}>Date</th><th style={{ minWidth: 280 }}>Exercice</th><th style={{ width: 230 }}>Activités couvertes</th>
              <th style={{ width: 140 }}>Pilote</th><th style={{ width: 190 }}>Résultat</th><th style={{ width: 110 }}>Actions</th>
            </tr></thead>
            <tbody>
              {shownExercises.length === 0 ? <tr><td colSpan={6} className="ds-empty">Aucun exercice ne correspond.</td></tr> : shownExercises.map((e) => {
                const outcome = exerciseOutcome(e);
                return (
                  <tr key={e.id} tabIndex={0} onClick={() => setOpenId(e.id)} onKeyDown={(ev) => onEnter(ev, () => setOpenId(e.id))}>
                    <td className="bcp-num">{frDate(e.scheduledOn)}</td>
                    <td><div className="ds-primary">{e.title}<small>{EXERCISE_KIND_LABEL[e.kind]}</small></div></td>
                    <td className="bcp-deps">{e.activities.length === 0 ? <span className="ds-muted">—</span> : e.activities.map((a) => a.name).join(', ')}</td>
                    <td>{e.leadName ?? <span className="ds-muted">—</span>}</td>
                    <td>
                      <span className={`bcp-state bcp-state--${outcome.tone}`}>{outcome.label}</span>
                      {e.recoveryMinutes !== null ? <small className="bcp-sub">Reprise en {minutes(e.recoveryMinutes)}</small> : null}
                    </td>
                    <td>{e.actionCount === 0 ? <span className="ds-muted">—</span> : <span className={e.openActionCount > 0 ? 'bcp-actions--open' : ''}>{e.openActionCount > 0 ? `${e.openActionCount} en cours` : `${e.actionCount} soldée${e.actionCount > 1 ? 's' : ''}`}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}

      {creating === 'activite' ? (
        <Drawer header={<><span className="ds-id" id="bcp-new">Nouvelle activité</span><span className="ds-chip">Bilan d’impact</span></>} labelId="bcp-new" onClose={() => setCreating(null)}>
          <div className="drawer-wide">
            <ActivityForm
              slug={slug} today={today} members={members} processes={processes} documents={documents} assets={assets} suppliers={suppliers}
              onDone={(id) => { setCreating(null); setOpenId(id); }} onCancel={() => setCreating(null)}
            />
          </div>
        </Drawer>
      ) : creating ? (
        <Drawer header={<><span className="ds-id" id="bcp-new">Nouvel exercice</span><span className="ds-chip">Continuité</span></>} labelId="bcp-new" onClose={() => setCreating(null)}>
          <div className="drawer-wide">
            <ExerciseForm
              slug={slug} today={today} userId={userId} members={members} activities={activities} evidences={evidences} initial={creating.exercise}
              onDone={(id) => { setCreating(null); setOpenId(id); }} onCancel={() => setCreating(null)}
            />
          </div>
        </Drawer>
      ) : null}

      {openActivity ? (
        <ActivityDrawer
          key={openActivity.id} slug={slug} today={today} canManage={canManage} activity={openActivity} exercises={exercises}
          members={members} processes={processes} documents={documents} assets={assets} suppliers={suppliers}
          onOpen={(id) => { setTab('exercices'); setOpenId(id); }} onPlan={() => planExercise(openActivity.id)} onClose={() => setOpenId(null)}
        />
      ) : null}
      {openExercise ? (
        <ExerciseDrawer
          key={openExercise.id} slug={slug} today={today} userId={userId} canManage={canManage} exercise={openExercise}
          activities={activities} members={members} evidences={evidences}
          onOpen={(id) => { setTab('activites'); setOpenId(id); }} onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function dependencies(a: ContinuityActivityRow): string {
  const parts = [
    a.assets.length > 0 ? `${a.assets.length} actif${a.assets.length > 1 ? 's' : ''}` : null,
    a.suppliers.length > 0 ? `${a.suppliers.length} fournisseur${a.suppliers.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

function DeleteButton({ label, confirmText, onConfirm }: { label: string; confirmText: string; onConfirm: () => Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirming) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>Supprimer</button>;
  return (
    <div className="bcp-confirm" role="group" aria-label="Confirmer la suppression">
      <p>{confirmText}</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Annuler</button>
        <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => start(async () => setError(await onConfirm()))}>
          {pending ? 'Suppression…' : label}
        </button>
      </div>
    </div>
  );
}

// ── Tiroir d'une activité ───────────────────────────────────────────────
function ActivityDrawer({ slug, today, canManage, activity: a, exercises, members, processes, documents, assets, suppliers, onOpen, onPlan, onClose }: {
  slug: string; today: string; canManage: boolean; activity: ContinuityActivityRow; exercises: ContinuityExerciseRow[];
  members: TenantMember[]; processes: Lite[] | null; documents: Lite[]; assets: Lite[]; suppliers: Lite[] | null;
  onOpen: (exerciseId: string) => void; onPlan: () => void; onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const covering = exercises.filter((e) => e.activities.some((x) => x.id === a.id));
  const header = (
    <>
      <span className={`bcp-crit bcp-crit--${a.criticality}`} id="bcp-title">{CRITICALITY_LABEL[a.criticality]}</span>
      <span className={`bcp-state bcp-state--${a.state}`}>{ACTIVITY_CONTINUITY_STATE_LABEL[a.state]}</span>
    </>
  );

  if (editing) {
    return (
      <Drawer header={header} labelId="bcp-title" onClose={onClose}>
        <div className="drawer-wide">
          <p className="drawer-section-label">Modifier le bilan d’impact</p>
          <ActivityForm
            slug={slug} today={today} members={members} processes={processes} documents={documents} assets={assets} suppliers={suppliers}
            activity={a} onDone={() => setEditing(false)} onCancel={() => setEditing(false)}
          />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer header={header} labelId="bcp-title" onClose={onClose}>
      <div className="drawer-section">
        <h2 className="bcp-title">{a.name}</h2>
        {a.description ? <p className="bcp-text">{a.description}</p> : null}
        <dl className="bcp-facts">
          <div><dt>DMIA (RTO)</dt><dd>{hours(a.rtoHours)} d’interruption au plus</dd></div>
          <div><dt>PDMA (RPO)</dt><dd>{a.rpoHours === 0 ? 'aucune perte de données admise' : `${hours(a.rpoHours)} de données au plus`}</dd></div>
          <div><dt>Responsable</dt><dd>{a.ownerName ?? '—'}</dd></div>
          {a.processName && a.processId ? <div><dt>Processus</dt><dd><a className="bcp-link" href={`/t/${slug}/processus?ouvrir=${a.processId}`}>{a.processName}</a></dd></div> : null}
          <div><dt>Plan de continuité</dt><dd>{a.planDocumentId ? <a className="bcp-link" href={`/t/${slug}/documents?ouvrir=${a.planDocumentId}`}>{a.planDocumentTitle ?? 'Consulter'}</a> : <span className="ds-muted">Aucun document rattaché</span>}</dd></div>
          <div><dt>Bilan d’impact</dt><dd>du {frDate(a.assessedOn)}{a.biaDueOn < today ? <span className="bcp-sub--warn"> · à revoir depuis le {frDate(a.biaDueOn)}</span> : <> · à revoir avant le {frDate(a.biaDueOn)}</>}</dd></div>
        </dl>
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Mode dégradé</p>
        <p className="bcp-text">{a.degradedMode ?? <span className="ds-muted">Non décrit : comment l’activité continue-t-elle pendant l’interruption ?</span>}</p>
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Dépendances</p>
        {a.assets.length === 0 && a.suppliers.length === 0 ? <p className="ds-muted">Aucune dépendance déclarée.</p> : (
          <div className="bcp-chips">
            {a.assets.map((x) => <a key={x.id} className="ds-chip" href={`/t/${slug}/actifs?ouvrir=${x.id}`} title="Actif">{x.name}</a>)}
            {a.suppliers.map((x) => <a key={x.id} className="ds-chip" href={`/t/${slug}/fournisseurs?ouvrir=${x.id}`} title="Fournisseur">{x.name}</a>)}
          </div>
        )}
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Exercices ({covering.length})</p>
        {covering.length === 0 ? <p className="ds-muted">Jamais testée.</p> : (
          <ul className="bcp-list">
            {covering.map((e) => {
              const outcome = exerciseOutcome(e);
              return (
                <li key={e.id}>
                  <button type="button" className="link-button" onClick={() => onOpen(e.id)}>{e.title}</button>
                  <span className="ds-muted"> — {frDate(e.scheduledOn)}, </span>
                  <span className={`bcp-state bcp-state--${outcome.tone}`}>{outcome.label}</span>
                  {e.recoveryMinutes !== null ? <span className={e.recoveryMinutes > a.rtoHours * 60 ? 'bcp-sub--danger' : 'ds-muted'}> · reprise en {minutes(e.recoveryMinutes)}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canManage ? (
        <div className="drawer-section bcp-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Modifier</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onPlan}>Planifier un exercice</button>
          <DeleteButton
            label="Supprimer l’activité"
            confirmText={`Supprimer « ${a.name} » ? Son bilan d’impact et ses dépendances quittent le registre, et elle est retirée des exercices qui la couvraient. Le journal d’audit garde la trace de la suppression.`}
            onConfirm={async () => {
              const r = await deleteContinuityActivityAction(slug, { id: a.id });
              if (!r.ok) return r.error.message;
              onClose();
              router.refresh();
              return null;
            }}
          />
        </div>
      ) : null}
    </Drawer>
  );
}

// ── Formulaire d'activité ───────────────────────────────────────────────
function ActivityForm({ slug, today, members, processes, documents, assets, suppliers, activity, onDone, onCancel }: {
  slug: string; today: string; members: TenantMember[]; processes: Lite[] | null; documents: Lite[]; assets: Lite[]; suppliers: Lite[] | null;
  activity?: ContinuityActivityRow; onDone: (id: string) => void; onCancel: () => void;
}) {
  const router = useRouter();
  const [assetIds, setAssetIds] = useState<Set<string>>(() => new Set(activity?.assets.map((x) => x.id) ?? []));
  const [supplierIds, setSupplierIds] = useState<Set<string>>(() => new Set(activity?.suppliers.map((x) => x.id) ?? []));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (set: Set<string>, update: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    update(next);
  };

  function submit(fd: FormData) {
    setError(null);
    const text = (name: string) => String(fd.get(name) ?? '');
    const input = {
      name: text('name'),
      description: text('description'),
      ownerUserId: text('ownerUserId') || null,
      processId: text('processId') || null,
      criticality: Number(text('criticality')),
      rtoHours: Number(text('rtoHours')),
      rpoHours: Number(text('rpoHours')),
      degradedMode: text('degradedMode'),
      planDocumentId: text('planDocumentId') || null,
      assessedOn: text('assessedOn'),
      assetIds: [...assetIds],
      supplierIds: [...supplierIds],
    };
    const ruleError = input.assessedOn > today ? 'La date du bilan d’impact ne peut pas être dans le futur.' : activityError(input);
    if (ruleError) {
      setError(ruleError);
      return;
    }
    start(async () => {
      if (activity) {
        const r = await updateContinuityActivityAction(slug, { activityId: activity.id, ...input });
        if (r.ok) { router.refresh(); onDone(activity.id); } else setError(r.error.message);
        return;
      }
      const r = await createContinuityActivityAction(slug, input);
      if (r.ok) { router.refresh(); onDone(r.data.activityId); } else setError(r.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)}>
      <label className="field">Activité
        <input name="name" required minLength={2} maxLength={200} defaultValue={activity?.name ?? ''} placeholder="Préparation et expédition des commandes" />
      </label>
      <label className="field">Description
        <textarea name="description" rows={2} maxLength={2000} defaultValue={activity?.description ?? ''} placeholder="Ce que fait l’activité, où, pour qui" />
      </label>
      <div className="risk-form-grid">
        <label className="field">Criticité
          <select name="criticality" defaultValue={String(activity?.criticality ?? 3)}>
            {CRITICALITY_LEVELS.map((c) => <option key={c} value={c}>{CRITICALITY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="field">Responsable
          <select name="ownerUserId" defaultValue={activity?.ownerUserId ?? ''}>
            <option value="">— À désigner —</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </label>
        <label className="field">DMIA — interruption admissible (heures)
          <input name="rtoHours" type="number" required min={0} max={8760} step={1} inputMode="numeric" defaultValue={activity?.rtoHours ?? ''} />
        </label>
        <label className="field">PDMA — perte de données admissible (heures)
          <input name="rpoHours" type="number" required min={0} max={8760} step={1} inputMode="numeric" defaultValue={activity?.rpoHours ?? ''} />
        </label>
        {processes ? (
          <label className="field">Processus
            <select name="processId" defaultValue={activity?.processId ?? ''}>
              <option value="">— Aucun —</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        ) : null}
        <label className="field">Plan de continuité (document)
          <select name="planDocumentId" defaultValue={activity?.planDocumentId ?? ''}>
            <option value="">— Aucun —</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <label className="field">Date du bilan d’impact
          <input name="assessedOn" type="date" required max={today} defaultValue={activity?.assessedOn ?? today} />
        </label>
      </div>
      <label className="field">Mode dégradé
        <textarea name="degradedMode" rows={3} maxLength={4000} defaultValue={activity?.degradedMode ?? ''} placeholder="Comment l’activité continue pendant l’interruption : procédure papier, site de repli, prestataire de secours…" />
      </label>
      <fieldset className="bcp-picks">
        <legend>Actifs dont elle dépend</legend>
        {assets.length === 0 ? <p className="ds-muted">Aucun actif à l’inventaire.</p> : (
          <div className="bcp-picks-list">
            {assets.map((x) => (
              <label key={x.id}><input type="checkbox" checked={assetIds.has(x.id)} onChange={() => toggle(assetIds, setAssetIds, x.id)} /><span>{x.label}</span></label>
            ))}
          </div>
        )}
      </fieldset>
      {suppliers ? (
        <fieldset className="bcp-picks">
          <legend>Fournisseurs dont elle dépend</legend>
          {suppliers.length === 0 ? <p className="ds-muted">Aucun fournisseur au registre.</p> : (
            <div className="bcp-picks-list">
              {suppliers.map((x) => (
                <label key={x.id}><input type="checkbox" checked={supplierIds.has(x.id)} onChange={() => toggle(supplierIds, setSupplierIds, x.id)} /><span>{x.label}</span></label>
              ))}
            </div>
          )}
        </fieldset>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : activity ? 'Enregistrer' : 'Enregistrer l’activité'}</button>
      </div>
    </form>
  );
}

// ── Tiroir d'un exercice ────────────────────────────────────────────────
function ExerciseDrawer({ slug, today, userId, canManage, exercise: e, activities, members, evidences, onOpen, onClose }: {
  slug: string; today: string; userId: string; canManage: boolean; exercise: ContinuityExerciseRow; activities: ContinuityActivityRow[];
  members: TenantMember[]; evidences: Lite[]; onOpen: (activityId: string) => void; onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const outcome = exerciseOutcome(e);
  const covered = activities.filter((a) => e.activities.some((x) => x.id === a.id));
  const strictest = covered.length === 0 ? null : covered.reduce((min, a) => (a.rtoHours < min.rtoHours ? a : min));
  const canRecord = e.status === 'planifie' && e.scheduledOn <= today;
  const header = (
    <>
      <span className="ds-id" id="bcp-title">{frDate(e.scheduledOn)}</span>
      <span className={`bcp-state bcp-state--${outcome.tone}`}>{outcome.label}</span>
    </>
  );

  if (editing) {
    return (
      <Drawer header={header} labelId="bcp-title" onClose={onClose}>
        <div className="drawer-wide">
          <p className="drawer-section-label">{canRecord ? 'Consigner le résultat' : 'Modifier l’exercice'}</p>
          <ExerciseForm
            slug={slug} today={today} userId={userId} members={members} activities={activities} evidences={evidences}
            exerciseId={e.id} initial={{ ...e, activityIds: e.activities.map((x) => x.id), status: canRecord ? 'realise' : e.status }}
            onDone={() => setEditing(false)} onCancel={() => setEditing(false)}
          />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer header={header} labelId="bcp-title" onClose={onClose}>
      <div className="drawer-section">
        <h2 className="bcp-title">{e.title}</h2>
        <dl className="bcp-facts">
          <div><dt>Type</dt><dd>{EXERCISE_KIND_LABEL[e.kind]}</dd></div>
          <div><dt>Date</dt><dd>{frDate(e.scheduledOn)} · {EXERCISE_STATUS_LABEL[e.status]}</dd></div>
          <div><dt>Pilote</dt><dd>{e.leadName ?? '—'}</dd></div>
          {e.recoveryMinutes !== null ? (
            <div>
              <dt>Reprise mesurée</dt>
              <dd>
                {minutes(e.recoveryMinutes)}
                {strictest ? (
                  <span className={e.recoveryMinutes > strictest.rtoHours * 60 ? 'bcp-sub--danger' : 'ds-muted'}>
                    {' '}pour une DMIA de {hours(strictest.rtoHours)} ({strictest.name})
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Activités couvertes ({e.activities.length})</p>
        {e.activities.length === 0 ? <p className="ds-muted">Aucune activité rattachée.</p> : (
          <div className="bcp-chips">
            {e.activities.map((x) => <button key={x.id} type="button" className="ds-chip bcp-chip-button" onClick={() => onOpen(x.id)}>{x.name}</button>)}
          </div>
        )}
      </div>

      {e.findings ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Enseignements</p>
          <p className="bcp-text">{e.findings}</p>
        </div>
      ) : null}

      {e.status === 'realise' ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Rapport</p>
          {e.evidenceId ? (
            <a className="bcp-link" href={`/t/${slug}/preuves?ouvrir=${e.evidenceId}`}>{e.evidenceTitle ?? 'Consulter la preuve'}</a>
          ) : canManage ? <ReportUpload slug={slug} exercise={e} /> : <p className="ds-muted">Aucun rapport au coffre.</p>}
        </div>
      ) : null}

      {e.status === 'realise' ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Actions correctives</p>
          {e.actionCount > 0 ? (
            <p className="bcp-text">
              {e.openActionCount > 0 ? `${e.openActionCount} en cours` : 'Toutes soldées'} sur {e.actionCount} —{' '}
              <a className="bcp-link" href={`/t/${slug}/plan-action`}>voir le plan d’action</a>
            </p>
          ) : <p className="ds-muted">{e.result === 'atteint' ? 'Aucune : les objectifs ont été atteints.' : 'Aucune action ouverte à partir des enseignements.'}</p>}
          {canManage ? <CorrectiveAction slug={slug} today={today} userId={userId} exercise={e} members={members} /> : null}
        </div>
      ) : null}

      {canManage ? (
        <div className="drawer-section bcp-actions">
          <button type="button" className={canRecord ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => setEditing(true)}>
            {canRecord ? 'Consigner le résultat' : 'Modifier'}
          </button>
          <DeleteButton
            label="Supprimer l’exercice"
            confirmText={`Supprimer « ${e.title} » ? L’exercice quitte le registre ; son rapport reste au coffre de preuves et ses actions au plan d’action. Le journal d’audit garde la trace de la suppression.`}
            onConfirm={async () => {
              const r = await deleteContinuityExerciseAction(slug, { id: e.id });
              if (!r.ok) return r.error.message;
              onClose();
              router.refresh();
              return null;
            }}
          />
        </div>
      ) : null}
    </Drawer>
  );
}

/** Rapport de l'exercice : ingestion au coffre (empreinte, antivirus), puis rattachement. */
function ReportUpload({ slug, exercise }: { slug: string; exercise: ContinuityExerciseRow }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    fd.set('type', exercise.kind === 'restauration' || exercise.kind === 'bascule' ? 'pv' : 'rapport');
    fd.set('collectedAt', exercise.scheduledOn);
    fd.set('recurrence', 'ponctuelle');
    start(async () => {
      const created = await createEvidenceAction(slug, fd);
      if (!created.ok) {
        setError(created.error.message);
        return;
      }
      const attached = await attachExerciseReportAction(slug, { exerciseId: exercise.id, evidenceId: created.data.evidenceId });
      if (!attached.ok) setError(`${attached.error.message} Le fichier est bien au coffre de preuves : choisissez-le depuis « Modifier ».`);
      router.refresh();
    });
  }

  return (
    <form className="bcp-upload" onSubmit={keepValues(submit)}>
      <label className="field">Intitulé
        <input name="title" required minLength={2} maxLength={200} defaultValue={`Rapport — ${exercise.title}`.slice(0, 200)} />
      </label>
      <label className="field">Fichier (PDF, image, tableur ou document, 10 Mo au plus)
        <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.docx,.txt" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Dépôt…' : 'Déposer au coffre et rattacher'}</button>
      </div>
      <p className="bcp-hint">Le fichier est haché (SHA-256) et analysé par l’antivirus avant d’entrer au coffre de preuves.</p>
    </form>
  );
}

function CorrectiveAction({ slug, today, userId, exercise, members }: {
  slug: string; today: string; userId: string; exercise: ContinuityExerciseRow; members: TenantMember[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData, form: HTMLFormElement) {
    setError(null);
    start(async () => {
      const r = await planExerciseActionAction(slug, {
        exerciseId: exercise.id,
        title: String(fd.get('title') ?? ''),
        ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
        dueDate: String(fd.get('dueDate') ?? ''),
        priority: String(fd.get('priority') ?? 'p2'),
      });
      if (r.ok) {
        form.reset();
        setOpen(false);
        setNotice('Action ouverte : elle apparaît au plan d’action et le responsable est prévenu.');
        router.refresh();
      } else setError(r.error.message);
    });
  }

  if (!open) {
    return (
      <>
        {notice ? <p className="bcp-notice" role="status">{notice}</p> : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNotice(null); setOpen(true); }}>Ouvrir une action corrective</button>
      </>
    );
  }
  return (
    <form className="bcp-upload" onSubmit={keepValues(submit)}>
      <label className="field">Action
        <input name="title" required minLength={3} maxLength={200} placeholder="Mettre à jour la procédure de mode dégradé de Meyzieu" />
      </label>
      <div className="risk-form-grid">
        <label className="field">Responsable
          <select name="ownerUserId" defaultValue={userId}>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.userId === userId ? ' (vous)' : ''}</option>)}
          </select>
        </label>
        <label className="field">Échéance
          <input name="dueDate" type="date" required min={today} defaultValue={addDaysIso(today, 30)} />
        </label>
        <label className="field">Priorité
          <select name="priority" defaultValue={exercise.result === 'non_atteint' ? 'p1' : 'p2'}>
            <option value="p1">P1 — haute</option>
            <option value="p2">P2 — moyenne</option>
            <option value="p3">P3 — basse</option>
          </select>
        </label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Ouverture…' : 'Ouvrir l’action'}</button>
      </div>
    </form>
  );
}

// ── Formulaire d'exercice ───────────────────────────────────────────────
interface ExerciseInitial {
  title: string; kind: ExerciseKind; scheduledOn: string; status: ExerciseStatus; result: ExerciseResult | null;
  recoveryMinutes: number | null; findings: string | null; evidenceId: string | null; evidenceTitle: string | null;
  leadUserId: string | null; activityIds: string[];
}

function ExerciseForm({ slug, today, userId, members, activities, evidences, initial, exerciseId, onDone, onCancel }: {
  slug: string; today: string; userId: string; members: TenantMember[]; activities: ContinuityActivityRow[]; evidences: Lite[];
  initial: Partial<ExerciseInitial>; exerciseId?: string; onDone: (id: string) => void; onCancel: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ExerciseStatus>(initial.status ?? 'planifie');
  const [result, setResult] = useState<ExerciseResult>(initial.result ?? 'atteint');
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial.activityIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = status === 'realise';
  const reportOptions = initial.evidenceId && !evidences.some((x) => x.id === initial.evidenceId)
    ? [{ id: initial.evidenceId, label: initial.evidenceTitle ?? 'Preuve rattachée' }, ...evidences]
    : evidences;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function submit(fd: FormData) {
    setError(null);
    const text = (name: string) => String(fd.get(name) ?? '').trim();
    const h = text('recoveryHours');
    const m = text('recoveryMins');
    const recoveryMinutes = done && (h !== '' || m !== '') ? Number(h || 0) * 60 + Number(m || 0) : null;
    const input = {
      title: text('title'),
      kind: text('kind'),
      scheduledOn: text('scheduledOn'),
      status,
      result: done ? result : null,
      recoveryMinutes,
      findings: text('findings') || null,
      evidenceId: done ? text('evidenceId') || null : null,
      leadUserId: text('leadUserId') || null,
      activityIds: [...checked],
    };
    const ruleError = exerciseError(input, today);
    if (ruleError) {
      setError(ruleError);
      return;
    }
    start(async () => {
      if (exerciseId) {
        const r = await updateContinuityExerciseAction(slug, { exerciseId, ...input });
        if (r.ok) { router.refresh(); onDone(exerciseId); } else setError(r.error.message);
        return;
      }
      const r = await createContinuityExerciseAction(slug, input);
      if (r.ok) { router.refresh(); onDone(r.data.exerciseId); } else setError(r.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)}>
      <label className="field">Intitulé
        <input name="title" required minLength={2} maxLength={200} defaultValue={initial.title ?? ''} placeholder="Test de restauration des sauvegardes du WMS" />
      </label>
      <div className="risk-form-grid">
        <label className="field">Type
          <select name="kind" defaultValue={initial.kind ?? 'restauration'}>
            {EXERCISE_KINDS.map((k) => <option key={k} value={k}>{EXERCISE_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">Date
          <input name="scheduledOn" type="date" required defaultValue={initial.scheduledOn ?? today} />
        </label>
        <label className="field">Statut
          <select value={status} onChange={(ev) => setStatus(ev.target.value as ExerciseStatus)}>
            <option value="planifie">Planifié</option>
            <option value="realise">Réalisé</option>
            <option value="annule">Annulé</option>
          </select>
        </label>
        <label className="field">Pilote
          <select name="leadUserId" defaultValue={initial.leadUserId ?? userId}>
            <option value="">— À désigner —</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.userId === userId ? ' (vous)' : ''}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="bcp-picks">
        <legend>Activités couvertes</legend>
        {activities.length === 0 ? <p className="ds-muted">Aucune activité au bilan d’impact.</p> : (
          <div className="bcp-picks-list">
            {activities.map((a) => (
              <label key={a.id}>
                <input type="checkbox" checked={checked.has(a.id)} onChange={() => toggle(a.id)} />
                <span>{a.name}<small> · DMIA {hours(a.rtoHours)}</small></span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {done ? (
        <div className="bcp-result">
          <div className="risk-form-grid">
            <label className="field">Résultat
              <select value={result} onChange={(ev) => setResult(ev.target.value as ExerciseResult)}>
                {EXERCISE_RESULTS.map((r) => <option key={r} value={r}>{EXERCISE_RESULT_LABEL[r]}</option>)}
              </select>
            </label>
            <div className="field">
              <span>Durée de reprise mesurée</span>
              <div className="bcp-duration">
                <input name="recoveryHours" type="number" min={0} max={8760} step={1} inputMode="numeric" aria-label="Heures"
                  defaultValue={initial.recoveryMinutes != null ? Math.floor(initial.recoveryMinutes / 60) : ''} />
                <span>h</span>
                <input name="recoveryMins" type="number" min={0} max={59} step={1} inputMode="numeric" aria-label="Minutes"
                  defaultValue={initial.recoveryMinutes != null ? initial.recoveryMinutes % 60 : ''} />
                <span>min</span>
              </div>
            </div>
          </div>
          <label className="field">Rapport (coffre de preuves)
            <select name="evidenceId" defaultValue={initial.evidenceId ?? ''}>
              <option value="">— Aucun pour l’instant —</option>
              {reportOptions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        </div>
      ) : null}
      <label className="field">{done && result !== 'atteint' ? 'Enseignements — ce qui n’a pas fonctionné (obligatoire)' : 'Objectifs et enseignements'}
        <textarea name="findings" rows={3} maxLength={4000} defaultValue={initial.findings ?? ''}
          placeholder={done ? 'Durées constatées, écarts à la procédure, dépendances oubliées, points à corriger…' : 'Scénario, objectifs, participants…'} />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? 'Enregistrement…' : exerciseId ? 'Enregistrer' : done ? 'Enregistrer l’exercice' : 'Planifier l’exercice'}
        </button>
      </div>
    </form>
  );
}
