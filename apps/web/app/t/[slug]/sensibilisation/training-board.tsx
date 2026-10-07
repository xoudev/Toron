'use client';

import {
  LEADER_ROLES,
  LEADER_TRAINING_STATE_LABEL,
  MEMBERSHIP_ROLE_LABEL,
  TRAINING_KINDS,
  TRAINING_KIND_LABEL,
  TRAINING_SESSION_STATE_LABEL,
  foldForSearch,
  searchTerms,
  trainingSessionError,
  type TrainingKind,
} from '@toron/core';
import type { LeaderTrainingRow, TenantMember, TrainingSessionRow } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type KeyboardEvent } from 'react';

import { frDate, initials } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { useOpenItem } from '@/lib/use-open-item';

import { createEvidenceAction } from '../preuves/evidence-actions';
import {
  attachTrainingSheetAction,
  createTrainingSessionAction,
  deleteTrainingSessionAction,
  updateTrainingSessionAction,
} from './training-actions';

type Lite = { id: string; label: string };

const isLeader = (role: string) => (LEADER_ROLES as readonly string[]).includes(role);

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

function rate(s: TrainingSessionRow): number | null {
  return s.expectedCount && s.attendedCount !== null ? Math.round((100 * s.attendedCount) / s.expectedCount) : null;
}

/** Participation en clair : attendus d'une session à venir, présents d'une session tenue. */
function participation(s: TrainingSessionRow): string {
  if (s.state === 'a_venir') return s.expectedCount !== null ? `${s.expectedCount} attendus` : 'Effectif attendu non précisé';
  if (s.attendedCount === null) return 'Présence à saisir';
  return s.expectedCount !== null ? `${s.attendedCount} présents sur ${s.expectedCount}` : `${s.attendedCount} présents`;
}

type View = 'toutes' | 'a_venir' | 'realisees' | 'sans_feuille';
const VIEWS: { key: View; label: string; match: (s: TrainingSessionRow) => boolean }[] = [
  { key: 'toutes', label: 'Toutes', match: () => true },
  { key: 'a_venir', label: 'À venir', match: (s) => s.state === 'a_venir' },
  { key: 'realisees', label: 'Réalisées', match: (s) => s.state === 'realisee' },
  { key: 'sans_feuille', label: 'Sans feuille d’émargement', match: (s) => s.state === 'realisee' && s.evidenceId === null },
];

/** À venir d'abord, la plus proche en tête ; puis les sessions tenues, la plus récente en tête. */
function bySchedule(a: TrainingSessionRow, b: TrainingSessionRow): number {
  if (a.state !== b.state) return a.state === 'a_venir' ? -1 : 1;
  return a.state === 'a_venir' ? a.heldOn.localeCompare(b.heldOn) : b.heldOn.localeCompare(a.heldOn);
}

function matches(s: TrainingSessionRow, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = foldForSearch([s.title, s.audience, s.provider, TRAINING_KIND_LABEL[s.kind]].filter(Boolean).join(' '));
  return terms.every((t) => hay.includes(t));
}

const LEADER_SESSION_TITLE = 'Formation des dirigeants à la cybersécurité (NIS 2, art. 20)';

export function TrainingBoard({ slug, today, userId, canManage, sessions, leaders, members, evidences }: {
  slug: string; today: string; userId: string; canManage: boolean; sessions: TrainingSessionRow[];
  leaders: LeaderTrainingRow[]; members: TenantMember[]; evidences: Lite[];
}) {
  const [view, setView] = useState<View>('toutes');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<Partial<FormInitial> | null>(null);
  const [openId, setOpenId] = useOpenItem(sessions.map((s) => s.id));
  const open = sessions.find((s) => s.id === openId) ?? null;

  const terms = searchTerms(query);
  const current = VIEWS.find((v) => v.key === view)!;
  const shown = [...sessions].sort(bySchedule).filter((s) => current.match(s) && matches(s, terms));

  function openRow(e: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpenId(id);
    }
  }

  return (
    <>
      <LeadersPanel
        leaders={leaders}
        canManage={canManage}
        onPlan={() => setCreating({ kind: 'formation_dirigeants', title: LEADER_SESSION_TITLE, audience: 'Comité de direction', heldOn: '' })}
      />

      <div className="ds-toolbar">
        <div className="view-toggle" role="group" aria-label="Filtrer les sessions">
          {VIEWS.map((v) => {
            const n = sessions.filter(v.match).length;
            if (v.key !== 'toutes' && n === 0) return null;
            return <button type="button" key={v.key} aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.label} · {n}</button>;
          })}
        </div>
        <div className="ds-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 20.5 20.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une session, un public, un intervenant" aria-label="Rechercher une session" />
        </div>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating({})}>+ Nouvelle session</button> : null}
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <h2>Aucune session enregistrée</h2>
          <p>
            Planifiez vos sessions de sensibilisation, vos exercices d’hameçonnage et la formation des dirigeants, puis
            enregistrez la participation et déposez la feuille d’émargement : c’est ce que demande l’auditeur.
          </p>
        </div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table trn-table" style={{ minWidth: 920 }}>
            <thead><tr>
              <th style={{ width: 104 }}>Date</th><th style={{ minWidth: 300 }}>Session</th><th style={{ width: 220 }}>Public</th>
              <th style={{ width: 170 }}>Participation</th><th style={{ width: 210 }}>Feuille d’émargement</th><th style={{ width: 104 }}>État</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={6} className="ds-empty">Aucune session dans cette vue.</td></tr>
              ) : shown.map((s) => {
                const pct = rate(s);
                return (
                  <tr key={s.id} tabIndex={0} onClick={() => setOpenId(s.id)} onKeyDown={(e) => openRow(e, s.id)}>
                    <td className="trn-date">{frDate(s.heldOn)}</td>
                    <td>
                      <div className="ds-primary">
                        {s.title}
                        <small>{TRAINING_KIND_LABEL[s.kind]}{s.durationMinutes ? ` · ${duration(s.durationMinutes)}` : ''}</small>
                      </div>
                    </td>
                    <td>{s.audience ?? <span className="ds-muted">—</span>}</td>
                    <td>
                      <div className="trn-rate">
                        <span>{participation(s)}</span>
                        {pct !== null ? (
                          <>
                            <span className="coverage-bar" aria-hidden="true"><span style={{ width: `${Math.min(pct, 100)}%` }} /></span>
                            <small>{pct}{'\u202f'}% de présence</small>
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {s.state === 'a_venir' ? <span className="ds-muted">Après la session</span>
                        : s.evidenceId ? <span className="trn-sheet">{s.evidenceTitle}</span>
                        : <span className="trn-sheet trn-sheet--missing">À déposer</span>}
                    </td>
                    <td><span className={`trn-pill trn-pill--${s.state}`}>{TRAINING_SESSION_STATE_LABEL[s.state]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? (
        <Drawer header={<><span className="ds-id" id="trn-new-title">Nouvelle session</span><span className="ds-chip">Sensibilisation</span></>} labelId="trn-new-title" onClose={() => setCreating(null)}>
          <div className="drawer-wide">
            <SessionForm
              slug={slug} today={today} userId={userId} members={members} evidences={evidences} initial={creating}
              onDone={(id) => { setCreating(null); setOpenId(id); }} onCancel={() => setCreating(null)}
            />
          </div>
        </Drawer>
      ) : null}
      {open ? (
        <SessionDrawer
          key={open.id} slug={slug} today={today} userId={userId} canManage={canManage} session={open}
          members={members} evidences={evidences} onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

// ── Formation des dirigeants (NIS 2, art. 20) ───────────────────────────
function leaderDetail(l: LeaderTrainingRow): string {
  if (!l.lastTrainedOn) return 'aucune formation enregistrée';
  const trained = `formé le ${frDate(l.lastTrainedOn)}`;
  return l.state === 'a_renouveler' ? `${trained}, échue le ${frDate(l.dueOn)}` : `${trained}, à renouveler avant le ${frDate(l.dueOn)}`;
}

function LeadersPanel({ leaders, canManage, onPlan }: { leaders: LeaderTrainingRow[]; canManage: boolean; onPlan: () => void }) {
  const toPlan = leaders.some((l) => l.state !== 'a_jour');
  return (
    <section className="card trn-leaders" aria-labelledby="trn-leaders-title">
      <div className="trn-leaders-head">
        <h2 id="trn-leaders-title">Formation des dirigeants</h2>
        <p>NIS 2, art. 20 : les membres des organes de direction suivent une formation à la cybersécurité, renouvelée chaque année.</p>
      </div>
      {leaders.length === 0 ? (
        <p className="trn-leaders-empty">
          Aucun membre n’a le rôle Propriétaire ou Direction : invitez les dirigeants dans les paramètres pour suivre leur formation.
        </p>
      ) : (
        <ul>
          {leaders.map((l) => (
            <li key={l.userId} className="trn-leader">
              <span className="ds-avatar" aria-hidden="true">{initials(l.name)}</span>
              <b className="trn-leader-name">{l.name}</b>
              <span className={`trn-pill trn-pill--${l.state}`}>{LEADER_TRAINING_STATE_LABEL[l.state]}</span>
              <small className="trn-leader-detail">{MEMBERSHIP_ROLE_LABEL[l.role]} · {leaderDetail(l)}</small>
            </li>
          ))}
        </ul>
      )}
      {canManage && toPlan ? (
        <button type="button" className="btn btn-ghost btn-sm trn-leaders-plan" onClick={onPlan}>Planifier une formation des dirigeants</button>
      ) : null}
    </section>
  );
}

// ── Tiroir d'une session ────────────────────────────────────────────────
function SessionDrawer({ slug, today, userId, canManage, session: s, members, evidences, onClose }: {
  slug: string; today: string; userId: string; canManage: boolean; session: TrainingSessionRow;
  members: TenantMember[]; evidences: Lite[]; onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const pct = rate(s);
  const header = (
    <>
      <span className="ds-id" id="trn-title">{frDate(s.heldOn)}</span>
      <span className={`trn-pill trn-pill--${s.state}`}>{TRAINING_SESSION_STATE_LABEL[s.state]}</span>
    </>
  );

  if (editing) {
    return (
      <Drawer header={header} labelId="trn-title" onClose={onClose}>
        <div className="drawer-wide">
          <p className="drawer-section-label">{s.state === 'realisee' && s.attendedCount === null ? 'Saisir la présence' : 'Modifier la session'}</p>
          <SessionForm
            slug={slug} today={today} userId={userId} members={members} evidences={evidences} sessionId={s.id}
            initial={{ ...s, attendeeIds: s.attendees.map((a) => a.userId) }} recorded={s.attendees}
            onDone={() => setEditing(false)} onCancel={() => setEditing(false)}
          />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer header={header} labelId="trn-title" onClose={onClose}>
      <div className="drawer-section">
        <h2 className="trn-title">{s.title}</h2>
        <dl className="trn-facts">
          <div><dt>Type</dt><dd>{TRAINING_KIND_LABEL[s.kind]}</dd></div>
          <div><dt>Date</dt><dd>{frDate(s.heldOn)}{s.durationMinutes ? `, ${duration(s.durationMinutes)}` : ''}</dd></div>
          {s.audience ? <div><dt>Public</dt><dd>{s.audience}</dd></div> : null}
          {s.provider ? <div><dt>Intervenant</dt><dd>{s.provider}</dd></div> : null}
          <div><dt>Participation</dt><dd>{participation(s)}{pct !== null ? ` (${pct}\u202f%)` : ''}</dd></div>
        </dl>
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Membres de l’organisation présents ({s.attendees.length})</p>
        {s.attendees.length === 0 ? (
          <p className="ds-muted">
            {s.state === 'a_venir' ? 'La présence se saisit une fois la session tenue.' : 'Aucun membre de l’organisation coché comme présent.'}
          </p>
        ) : (
          <div className="trn-chips">{s.attendees.map((a) => <span key={a.userId} className="ds-chip">{a.name ?? 'Ancien membre'}</span>)}</div>
        )}
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Feuille d’émargement</p>
        {s.evidenceId ? (
          <a className="trn-link" href={`/t/${slug}/preuves?ouvrir=${s.evidenceId}`}>{s.evidenceTitle ?? 'Consulter la preuve'}</a>
        ) : s.state === 'a_venir' ? (
          <p className="ds-muted">À déposer une fois la session tenue.</p>
        ) : canManage ? (
          <SheetUpload slug={slug} session={s} />
        ) : (
          <p className="trn-sheet trn-sheet--missing">Feuille d’émargement manquante.</p>
        )}
      </div>

      {s.notes ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Notes</p>
          <p className="trn-text">{s.notes}</p>
        </div>
      ) : null}

      {canManage ? (
        <div className="drawer-section trn-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            {s.state === 'realisee' && s.attendedCount === null ? 'Saisir la présence' : 'Modifier'}
          </button>
          <DeletePanel slug={slug} session={s} onDeleted={onClose} />
        </div>
      ) : null}
    </Drawer>
  );
}

/** Dépôt de la feuille d'émargement : ingestion au coffre (empreinte, antivirus), puis rattachement. */
function SheetUpload({ slug, session }: { slug: string; session: TrainingSessionRow }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    fd.set('type', 'attestation');
    fd.set('collectedAt', session.heldOn);
    fd.set('recurrence', 'ponctuelle');
    start(async () => {
      const created = await createEvidenceAction(slug, fd);
      if (!created.ok) {
        setError(created.error.message);
        return;
      }
      const attached = await attachTrainingSheetAction(slug, { sessionId: session.id, evidenceId: created.data.evidenceId });
      if (!attached.ok) setError(`${attached.error.message} Le fichier est bien au coffre de preuves : choisissez-le depuis « Modifier ».`);
      router.refresh();
    });
  }

  return (
    <form className="trn-upload" onSubmit={keepValues(submit)}>
      <label className="field">Intitulé
        <input name="title" required minLength={2} maxLength={200} defaultValue={`Feuille d’émargement — ${session.title}`.slice(0, 200)} />
      </label>
      <label className="field">Fichier (PDF, image, tableur ou document, 10 Mo au plus)
        <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.docx,.txt" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Dépôt…' : 'Déposer au coffre et rattacher'}</button>
      </div>
      <p className="trn-hint">Le fichier est haché (SHA-256) et analysé par l’antivirus avant d’entrer au coffre de preuves.</p>
    </form>
  );
}

function DeletePanel({ slug, session, onDeleted }: { slug: string; session: TrainingSessionRow; onDeleted: () => void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove() {
    setError(null);
    start(async () => {
      const r = await deleteTrainingSessionAction(slug, { sessionId: session.id });
      if (r.ok) {
        onDeleted();
        router.refresh();
      } else setError(r.error.message);
    });
  }

  if (!confirming) {
    return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>Supprimer</button>;
  }
  return (
    <div className="trn-confirm" role="group" aria-label="Confirmer la suppression">
      <p>
        Supprimer « {session.title} » ?{' '}
        {session.state === 'realisee'
          ? 'La session et ses présences quittent le registre ; la feuille d’émargement reste au coffre de preuves.'
          : 'La session planifiée quitte le registre.'}{' '}
        Le journal d’audit garde la trace de la suppression.
      </p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Annuler</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={pending}>{pending ? 'Suppression…' : 'Supprimer la session'}</button>
      </div>
    </div>
  );
}

// ── Formulaire : planification, saisie de la présence, modification ────
interface FormInitial {
  title: string; kind: TrainingKind; heldOn: string; durationMinutes: number | null; audience: string | null;
  expectedCount: number | null; attendedCount: number | null; provider: string | null; notes: string | null;
  evidenceId: string | null; evidenceTitle: string | null; attendeeIds: string[];
}

function SessionForm({ slug, today, userId, members, evidences, initial, sessionId, recorded = [], onDone, onCancel }: {
  slug: string; today: string; userId: string; members: TenantMember[]; evidences: Lite[]; initial: Partial<FormInitial>;
  sessionId?: string; recorded?: TrainingSessionRow['attendees']; onDone: (sessionId: string) => void; onCancel: () => void;
}) {
  const router = useRouter();
  const [heldOn, setHeldOn] = useState(initial.heldOn ?? today);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial.attendeeIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const upcoming = heldOn !== '' && heldOn > today;
  const recordedAttendance = initial.attendedCount != null || (initial.attendeeIds?.length ?? 0) > 0 || initial.evidenceId != null;
  // Présents enregistrés qui ont quitté l'organisation depuis : conservés tant qu'on ne les décoche pas.
  const former = recorded.filter((a) => !members.some((m) => m.userId === a.userId));
  const sheetOptions = initial.evidenceId && !evidences.some((e) => e.id === initial.evidenceId)
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
    const count = (name: string) => {
      const raw = String(fd.get(name) ?? '').trim();
      return raw === '' ? null : Number(raw);
    };
    const attendeeIds = upcoming ? [] : [...checked];
    const input = {
      title: String(fd.get('title') ?? ''),
      kind: String(fd.get('kind') ?? 'sensibilisation'),
      heldOn,
      durationMinutes: count('durationMinutes'),
      audience: String(fd.get('audience') ?? ''),
      expectedCount: count('expectedCount'),
      attendedCount: upcoming ? null : count('attendedCount'),
      provider: String(fd.get('provider') ?? ''),
      notes: String(fd.get('notes') ?? ''),
      evidenceId: upcoming ? null : String(fd.get('evidenceId') ?? '') || null,
      attendeeIds,
    };
    const ruleError = trainingSessionError(
      { heldOn, expectedCount: input.expectedCount, attendedCount: input.attendedCount, attendeeCount: attendeeIds.length },
      today,
    );
    if (ruleError) {
      setError(ruleError);
      return;
    }
    start(async () => {
      if (sessionId) {
        const r = await updateTrainingSessionAction(slug, { sessionId, ...input });
        if (r.ok) { router.refresh(); onDone(sessionId); } else setError(r.error.message);
        return;
      }
      const r = await createTrainingSessionAction(slug, input);
      if (r.ok) { router.refresh(); onDone(r.data.sessionId); } else setError(r.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)}>
      <label className="field">Intitulé
        <input name="title" required minLength={2} maxLength={200} defaultValue={initial.title ?? ''} placeholder="Sensibilisation des équipes de quai de Corbas" />
      </label>
      <div className="risk-form-grid">
        <label className="field">Type
          <select name="kind" defaultValue={initial.kind ?? 'sensibilisation'}>
            {TRAINING_KINDS.map((k) => <option key={k} value={k}>{TRAINING_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">Date
          <input type="date" required value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
        </label>
        <label className="field">Durée (minutes)
          <input name="durationMinutes" type="number" min={5} max={2880} step={5} inputMode="numeric" defaultValue={initial.durationMinutes ?? ''} />
        </label>
        <label className="field">Intervenant
          <input name="provider" maxLength={200} defaultValue={initial.provider ?? ''} placeholder="RSSI interne, organisme de formation…" />
        </label>
      </div>
      <label className="field">Public
        <input name="audience" maxLength={300} defaultValue={initial.audience ?? ''} placeholder="Préparateurs de commandes, entrepôt de Meyzieu" />
      </label>
      <div className="risk-form-grid">
        <label className="field">Personnes attendues
          <input name="expectedCount" type="number" min={0} max={100000} step={1} inputMode="numeric" defaultValue={initial.expectedCount ?? ''} />
        </label>
        <label className="field">Personnes présentes
          <input
            name="attendedCount" type="number" min={0} max={100000} step={1} inputMode="numeric" disabled={upcoming}
            defaultValue={initial.attendedCount ?? ''} placeholder={upcoming ? 'Après la session' : ''}
          />
        </label>
      </div>

      <fieldset className={`trn-attendees${upcoming ? ' trn-attendees--disabled' : ''}`} disabled={upcoming}>
        <legend>Membres de l’organisation présents</legend>
        <div className="trn-attendees-list">
          {members.map((m) => (
            <label key={m.userId}>
              <input type="checkbox" checked={checked.has(m.userId)} onChange={() => toggle(m.userId)} />
              <span>{m.name}{m.userId === userId ? ' (vous)' : ''}{isLeader(m.role) ? <small> · dirigeant</small> : null}</span>
            </label>
          ))}
          {former.map((a) => (
            <label key={a.userId}>
              <input type="checkbox" checked={checked.has(a.userId)} onChange={() => toggle(a.userId)} />
              <span>{a.name ?? 'Ancien membre'}<small> · a quitté l’organisation</small></span>
            </label>
          ))}
        </div>
        <p className="trn-hint">
          {upcoming
            ? 'La présence se saisit une fois la session tenue.'
            : 'Seuls les membres de Toron se nomment, pour suivre leur propre formation ; les autres participants se comptent dans « Personnes présentes ».'}
        </p>
      </fieldset>

      {upcoming ? null : (
        <label className="field">Feuille d’émargement ou attestation (coffre de preuves)
          <select name="evidenceId" defaultValue={initial.evidenceId ?? ''}>
            <option value="">— Aucune pour l’instant —</option>
            {sheetOptions.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </label>
      )}
      <label className="field">Notes
        <textarea name="notes" rows={3} maxLength={4000} defaultValue={initial.notes ?? ''} placeholder="Thèmes abordés, supports utilisés, suites à donner…" />
      </label>
      {upcoming ? null : <p className="trn-hint">Le fichier n’est pas encore au coffre ? Enregistrez la session, puis déposez-le depuis sa fiche.</p>}
      {upcoming && recordedAttendance ? (
        <p className="trn-warning" role="status">
          Une date future retire la présence saisie et la feuille d’émargement rattachée : la session redevient planifiée.
        </p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? 'Enregistrement…' : sessionId ? 'Enregistrer' : upcoming ? 'Planifier la session' : 'Enregistrer la session'}
        </button>
      </div>
    </form>
  );
}
