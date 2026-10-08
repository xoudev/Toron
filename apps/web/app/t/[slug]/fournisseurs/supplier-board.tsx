'use client';

import {
  ATTESTATION_KINDS,
  ATTESTATION_KIND_LABEL,
  SUPPLIER_ANSWERS,
  SUPPLIER_ANSWER_LABEL,
  SUPPLIER_QUESTIONS,
  SUPPLIER_RATING_LABEL,
  SUPPLIER_REQUEST_STATE_LABEL,
  addDaysIso,
  assessSupplier,
  attestationFreshness,
  nextAssessmentDue,
  supplierAssessmentState,
  supplierQuestion,
  supplierRequestState,
  type SupplierAnswer,
  type SupplierAnswers,
  type SupplierRating,
} from '@toron/core';
import type { SupplierDetail, SupplierRequestRow, SupplierSummary, TenantMember } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { useOpenItem } from '@/lib/use-open-item';

import {
  addSupplierAttestationAction,
  cancelSupplierRequestAction,
  createSupplierAction,
  createSupplierRequestAction,
  getSupplierDetailAction,
  recordSupplierAssessmentAction,
  removeSupplierAttestationAction,
  renewSupplierRequestLinkAction,
  requestSupplierActionAction,
  updateSupplierAction,
} from './supplier-actions';

const TIER_LABEL: Record<string, string> = { t1: 'T1 · critique', t2: 'T2', t3: 'T3' };
const CONTRACT_LABEL: Record<string, string> = { a_faire: 'À faire', en_cours: 'En cours', conforme: 'Conforme' };
const ACTION_STATUS_LABEL: Record<string, string> = { planifie: 'Planifiée', en_cours: 'En cours', verification: 'Vérification', termine: 'Terminée' };

function fmt(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

/** Date du jour à Paris, pour un horodatage reçu du serveur. */
function fmtDay(d: Date | string): string {
  return new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function RatingChip({ rating, score }: { rating: SupplierRating; score: number }) {
  return <span className={`sup-rating sup-rating--${rating}`}><b>{score}</b>{SUPPLIER_RATING_LABEL[rating]}</span>;
}

function AttestationCell({ s, today }: { s: SupplierSummary; today: string }) {
  if (s.attestationCount === 0) return <span className="ds-muted">—</span>;
  const state = attestationFreshness(s.nextAttestationExpiry, today);
  const text = state === 'expiree' ? 'Expirée' : state === 'bientot' ? `Expire le ${fmt(s.nextAttestationExpiry)}` : `${s.attestationCount} à jour`;
  return <span className={`fresh-tag fresh--${state}`}>{text}</span>;
}

function AssessmentCell({ s, today }: { s: SupplierSummary; today: string }) {
  const state = supplierAssessmentState(s.tier, s.lastAssessedOn, today);
  const request = s.responsesToReview > 0
    ? <span className="sup-request sup-request--received">Réponse à examiner</span>
    : s.openRequestDueOn ? <span className="sup-request">Questionnaire envoyé</span> : null;
  if (state === 'jamais') {
    if (request) return request;
    return s.tier === 't1' ? <span className="sup-rating sup-rating--sous_reserve">Jamais évalué</span> : <span className="ds-muted">—</span>;
  }
  return (
    <>
      <RatingChip rating={s.lastRating!} score={s.lastScore!} />
      {request ?? (state === 'a_refaire' ? <span className="sup-due">À refaire</span> : null)}
    </>
  );
}

export function SupplierBoard({ slug, canManage, suppliers, members, today }: { slug: string; canManage: boolean; suppliers: SupplierSummary[]; members: TenantMember[]; today: string }) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useOpenItem(suppliers.map((x) => x.id));
  const editing = suppliers.find((x) => x.id === openId) ?? null;
  const setEditing = (s: SupplierSummary | null) => setOpenId(s?.id ?? null);

  return (
    <>
      <div className="ds-toolbar">
        <span className="drawer-section-label" style={{ margin: 0 }}>Registre · {suppliers.length}</span>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouveau fournisseur</button> : null}
      </div>

      {suppliers.length === 0 ? (
        <div className="empty-state"><h2>Aucun fournisseur</h2><p>Recensez vos tiers pour piloter l’effet cascade sur votre conformité.</p></div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 1080 }}>
            <thead><tr>
              <th style={{ width: 74 }}>ID</th><th style={{ minWidth: 220 }}>Fournisseur</th><th style={{ width: 96 }}>Niveau</th>
              <th style={{ minWidth: 180 }}>Données confiées</th><th style={{ width: 100 }}>Contrat</th>
              <th style={{ width: 150 }}>Évaluation</th><th style={{ width: 150 }}>Attestations</th>
              <th style={{ width: 140 }}>Propriétaire</th><th style={{ width: 92 }}>Revue</th>
            </tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} onClick={() => setEditing(s)}>
                  <td className="ds-id">{refCode('FRN', s.id)}</td>
                  <td><div className="ds-primary">{s.name}{s.services ? <small>{s.services}</small> : null}</div></td>
                  <td><span className={`ds-chip${s.tier === 't1' ? ' accent' : ''}`}>{TIER_LABEL[s.tier]}</span></td>
                  <td className="ds-refchips">{s.dataCategories.length ? s.dataCategories.map((c, i) => <span className="ds-refchip" key={i}><span className="dot" />{c}</span>) : <span className="ds-muted">—</span>}</td>
                  <td><span className={`nc-status ncs--${s.contractStatus === 'conforme' ? 'efficace' : s.contractStatus === 'en_cours' ? 'en_traitement' : 'ouverte'}`}>{CONTRACT_LABEL[s.contractStatus]}</span></td>
                  <td><AssessmentCell s={s} today={today} /></td>
                  <td><AttestationCell s={s} today={today} /></td>
                  <td><div className="ds-owner"><span className="ds-avatar">{initials(s.ownerName)}</span><span>{s.ownerName ?? '—'}</span></div></td>
                  <td className="ds-mono">{fmt(s.nextReview)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? <SupplierDrawer slug={slug} members={members} supplier={null} canManage={canManage} today={today} onClose={() => setCreating(false)} /> : null}
      {editing ? <SupplierDrawer key={editing.id} slug={slug} members={members} supplier={editing} canManage={canManage} today={today} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

type Tab = 'fiche' | 'evaluation' | 'attestations' | 'actions';

function SupplierDrawer({ slug, members, supplier, canManage, today, onClose }: { slug: string; members: TenantMember[]; supplier: SupplierSummary | null; canManage: boolean; today: string; onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(supplier && supplier.responsesToReview > 0 ? 'evaluation' : 'fiche');
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const supplierId = supplier?.id ?? null;

  useEffect(() => {
    if (!supplierId) return;
    let alive = true;
    getSupplierDetailAction(slug, supplierId).then((r) => {
      if (!alive) return;
      if (r.ok) setDetail(r.data);
      else setLoadError(r.error.message);
    });
    return () => { alive = false; };
  }, [slug, supplierId]);

  async function reload() {
    if (!supplierId) return;
    const r = await getSupplierDetailAction(slug, supplierId);
    if (r.ok) setDetail(r.data);
    router.refresh();
  }

  const header = (
    <>
      <span className="ds-id" id="frn-title">{supplier ? refCode('FRN', supplier.id) : 'Nouveau'}</span>
      <span className="ds-chip">Fournisseur</span>
      {supplier ? <span className="ds-chip">{TIER_LABEL[supplier.tier]}</span> : null}
    </>
  );

  const openActions = detail?.actions.filter((a) => a.status !== 'termine').length ?? 0;
  const received = detail ? detail.requests.some((r) => r.status === 'soumise') : (supplier?.responsesToReview ?? 0) > 0;

  return (
    <Drawer header={header} labelId="frn-title" onClose={onClose}>
      <div className="drawer-wide">
        {supplier ? (
          <>
            <h2 className="sup-title">{supplier.name}</h2>
            <div className="view-toggle sup-tabs" role="group" aria-label="Sections du fournisseur">
              <button type="button" aria-pressed={tab === 'fiche'} onClick={() => setTab('fiche')}>Fiche</button>
              <button type="button" aria-pressed={tab === 'evaluation'} onClick={() => setTab('evaluation')}>Évaluation{received ? ' · réponse reçue' : ''}</button>
              <button type="button" aria-pressed={tab === 'attestations'} onClick={() => setTab('attestations')}>Attestations{detail ? ` · ${detail.attestations.length}` : ''}</button>
              <button type="button" aria-pressed={tab === 'actions'} onClick={() => setTab('actions')}>Actions{openActions ? ` · ${openActions}` : ''}</button>
            </div>
          </>
        ) : null}
        {loadError && tab !== 'fiche' ? <p className="form-error" role="alert">{loadError}</p> : null}
        {tab === 'fiche' ? <SupplierForm slug={slug} members={members} supplier={supplier} canManage={canManage} onClose={onClose} /> : null}
        {supplier && tab !== 'fiche' && !detail && !loadError ? <p className="ds-muted">Chargement…</p> : null}
        {supplier && detail && tab === 'evaluation' ? <EvaluationTab slug={slug} supplier={supplier} detail={detail} canManage={canManage} today={today} onChanged={reload} onShowActions={() => setTab('actions')} /> : null}
        {supplier && detail && tab === 'attestations' ? <AttestationsTab slug={slug} supplier={supplier} detail={detail} canManage={canManage} today={today} onChanged={reload} /> : null}
        {supplier && detail && tab === 'actions' ? <ActionsTab slug={slug} detail={detail} today={today} /> : null}
      </div>
    </Drawer>
  );
}

function SupplierForm({ slug, members, supplier, canManage, onClose }: { slug: string; members: TenantMember[]; supplier: SupplierSummary | null; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const isEdit = supplier !== null;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    const cats = String(fd.get('dataCategories') ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    const payload = { name: String(fd.get('name') ?? ''), tier: String(fd.get('tier') ?? 't3'), services: String(fd.get('services') ?? '') || null, dataCategories: cats, contractStatus: String(fd.get('contractStatus') ?? 'a_faire'), ownerUserId: String(fd.get('ownerUserId') ?? '') || null, nextReview: String(fd.get('nextReview') ?? '') || null };
    start(async () => {
      const res = isEdit ? await updateSupplierAction(slug, { supplierId: supplier!.id, ...payload }) : await createSupplierAction(slug, payload);
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)}>
      <label className="field">Nom<input name="name" defaultValue={supplier?.name ?? ''} minLength={2} required disabled={!canManage} /></label>
      <label className="field">Services fournis<textarea name="services" defaultValue={supplier?.services ?? ''} rows={2} disabled={!canManage} /></label>
      <div className="risk-form-grid">
        <label className="field">Niveau (tiering)<select name="tier" defaultValue={supplier?.tier ?? 't3'} disabled={!canManage}><option value="t1">T1 · critique</option><option value="t2">T2</option><option value="t3">T3</option></select></label>
        <label className="field">Clauses contractuelles<select name="contractStatus" defaultValue={supplier?.contractStatus ?? 'a_faire'} disabled={!canManage}>{Object.entries(CONTRACT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="field">Propriétaire<select name="ownerUserId" defaultValue={supplier?.ownerUserId ?? ''} disabled={!canManage}><option value="">— Non attribué —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
        <label className="field">Prochaine revue<input type="date" name="nextReview" defaultValue={supplier?.nextReview?.slice(0, 10) ?? ''} disabled={!canManage} /></label>
        <label className="field field--full">Données confiées (séparées par des virgules)<input name="dataCategories" defaultValue={supplier?.dataCategories.join(', ') ?? ''} placeholder="Données clients, Données RH…" disabled={!canManage} /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {canManage ? (
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'}</button></div>
      ) : null}
    </form>
  );
}

// ── Évaluation ──────────────────────────────────────────────────────────

function EvaluationTab({ slug, supplier, detail, canManage, today, onChanged, onShowActions }: { slug: string; supplier: SupplierSummary; detail: SupplierDetail; canManage: boolean; today: string; onChanged: () => Promise<void>; onShowActions: () => void }) {
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState<SupplierRequestRow | null>(null);
  const last = detail.assessments[0] ?? null;

  if (reviewing) {
    return (
      <AssessmentForm
        slug={slug} supplier={supplier} previous={reviewing.answers as SupplierAnswers} today={today} review={reviewing}
        onCancel={() => setReviewing(null)} onSaved={async () => { setReviewing(null); await onChanged(); }}
      />
    );
  }
  if (editing) {
    return <AssessmentForm slug={slug} supplier={supplier} previous={last?.answers ?? null} today={today} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await onChanged(); }} />;
  }

  const requests = <RequestsPanel slug={slug} supplier={supplier} requests={detail.requests} canManage={canManage} today={today} explain={!last} onChanged={onChanged} onReview={setReviewing} />;

  if (!last) {
    return (
      <>
        {requests}
        <div className="empty-state">
          <h2>Pas encore évalué</h2>
          <p>{SUPPLIER_QUESTIONS.length} questions couvrent la gouvernance, les accès, la protection des données, les incidents, la continuité et le contrat. La note et l’appréciation sont calculées automatiquement.</p>
          {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Évaluer ce fournisseur</button> : null}
        </div>
      </>
    );
  }

  const result = assessSupplier(last.answers, supplier.tier);
  const gaps = result.ok ? result.gaps : [];
  const blocking = result.ok ? result.blocking : [];
  const due = nextAssessmentDue(supplier.tier, last.assessedOn);
  const late = due < today;

  return (
    <>
      {requests}
      <div className={`sup-summary sup-rating--${last.rating}`}>
        <span className="sup-score">{last.score}<small>/100</small></span>
        <span><RatingChip rating={last.rating} score={last.score} /></span>
        <span className="sup-summary-meta">
          Évalué le {fmt(last.assessedOn)}{last.assessorName ? ` par ${last.assessorName}` : ''} ·{' '}
          {late ? <b style={{ color: 'var(--warn)' }}>réévaluation attendue depuis le {fmt(due)}</b> : <>prochaine évaluation avant le {fmt(due)}</>}
        </span>
      </div>
      {last.notes ? <p className="sup-notes">{last.notes}</p> : null}

      <p className="drawer-section-label">Écarts · {gaps.length}</p>
      {gaps.length === 0 ? (
        <p className="ds-muted" style={{ marginBottom: 16 }}>Aucun écart sur la dernière évaluation.</p>
      ) : (
        <ul className="sup-list">
          {gaps.map((key) => (
            <GapRow key={key} slug={slug} supplierId={supplier.id} supplierName={supplier.name} questionKey={key} answer={last.answers[key]!} blocking={blocking.includes(key)} detail={detail} canManage={canManage} onChanged={onChanged} onShowActions={onShowActions} />
          ))}
        </ul>
      )}

      {detail.assessments.length > 1 ? (
        <>
          <p className="drawer-section-label">Historique</p>
          <ul className="sup-list">
            {detail.assessments.slice(1).map((a) => (
              <li key={a.id}><span className="grow">{fmt(a.assessedOn)}<small>{a.assessorName ?? '—'}</small></span><RatingChip rating={a.rating} score={a.score} /></li>
            ))}
          </ul>
        </>
      ) : null}

      {canManage ? <div className="dialog-actions"><button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Nouvelle évaluation</button></div> : null}
    </>
  );
}

function GapRow({ slug, supplierId, supplierName, questionKey, answer, blocking, detail, canManage, onChanged, onShowActions }: { slug: string; supplierId: string; supplierName: string; questionKey: string; answer: SupplierAnswer; blocking: boolean; detail: SupplierDetail; canManage: boolean; onChanged: () => Promise<void>; onShowActions: () => void }) {
  const q = supplierQuestion(questionKey)!;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const title = `${supplierName} — ${q.correctiveAction}`;
  const open = detail.actions.find((a) => a.title === title && a.status !== 'termine');

  function request() {
    setError(null);
    start(async () => {
      const r = await requestSupplierActionAction(slug, { supplierId, questionKey });
      if (r.ok) await onChanged();
      else setError(r.error.message);
    });
  }

  return (
    <li>
      <span className="grow">
        {q.label}
        <small>{q.theme} · {SUPPLIER_ANSWER_LABEL[answer]}{blocking ? <> · <span className="sup-blocking">Point bloquant</span></> : null}</small>
        {error ? <small className="form-error" role="alert">{error}</small> : null}
      </span>
      {open ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onShowActions}>Action ouverte</button>
      ) : canManage ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={request} disabled={pending}>{pending ? 'Création…' : 'Demander une action'}</button>
      ) : null}
    </li>
  );
}

function AssessmentForm({ slug, supplier, previous, today, review, onCancel, onSaved }: { slug: string; supplier: SupplierSummary; previous: SupplierAnswers | null; today: string; review?: SupplierRequestRow; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [answers, setAnswers] = useState<SupplierAnswers>(() => ({ ...(previous ?? {}) }));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const preview = assessSupplier(answers, supplier.tier);
  const answered = SUPPLIER_QUESTIONS.filter((q) => answers[q.key]).length;

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const r = await recordSupplierAssessmentAction(slug, {
        supplierId: supplier.id,
        assessedOn: String(fd.get('assessedOn') ?? today),
        answers,
        notes: String(fd.get('notes') ?? '') || null,
        requestId: review?.id ?? null,
      });
      if (r.ok) await onSaved();
      else setError(r.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)}>
      {review ? (
        <p className="sup-hint">
          Réponses transmises par {review.contactName} le {review.submittedAt ? fmtDay(review.submittedAt) : '—'}. Vérifiez-les au regard
          des commentaires et des pièces dont vous disposez, corrigez celles que vous ne retenez pas, puis validez : l’évaluation
          est alors enregistrée à votre nom.
        </p>
      ) : previous ? <p className="sup-hint">Les réponses de la dernière évaluation sont reprises : modifiez celles qui ont changé.</p> : null}
      <label className="field">Date de l’évaluation<input type="date" name="assessedOn" defaultValue={today} max={today} required /></label>
      {SUPPLIER_QUESTIONS.map((q, i) => {
        const head = i === 0 || SUPPLIER_QUESTIONS[i - 1]!.theme !== q.theme ? <p className="sup-theme">{q.theme}</p> : null;
        return (
          <div key={q.key}>
            {head}
            <fieldset className="sup-question">
              <legend>{q.label}{q.blockingForCritical && supplier.tier === 't1' ? <span className="sup-blocking">Bloquant</span> : null}</legend>
              {review?.comments[q.key] ? <p className="sup-supplier-comment"><span>Fournisseur</span>{review.comments[q.key]}</p> : null}
              <div className="sup-answers">
                {SUPPLIER_ANSWERS.map((a) => (
                  <label key={a}>
                    <input type="radio" name={`q-${q.key}`} value={a} checked={answers[q.key] === a} onChange={() => setAnswers((prev) => ({ ...prev, [q.key]: a }))} />
                    {SUPPLIER_ANSWER_LABEL[a]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        );
      })}
      <label className="field" style={{ marginTop: 14 }}>Commentaire (sources consultées, réserves)<textarea name="notes" rows={3} maxLength={4000} defaultValue={review ? `Réponses du fournisseur reçues par le portail le ${review.submittedAt ? fmtDay(review.submittedAt) : '—'} (${review.contactName}).` : undefined} /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="sup-preview" aria-live="polite">
        {preview.ok ? <RatingChip rating={preview.rating} score={preview.score} /> : <span>{answered}/{SUPPLIER_QUESTIONS.length} réponses</span>}
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !preview.ok}>{pending ? 'Enregistrement…' : review ? 'Valider la réponse' : 'Enregistrer l’évaluation'}</button>
      </div>
    </form>
  );
}

// ── Portail fournisseur : demandes de réponse ───────────────────────────

function RequestsPanel({ slug, supplier, requests, canManage, today, explain, onChanged, onReview }: { slug: string; supplier: SupplierSummary; requests: SupplierRequestRow[]; canManage: boolean; today: string; explain: boolean; onChanged: () => Promise<void>; onReview: (r: SupplierRequestRow) => void }) {
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<{ link: string; expiresOn: string; email: string } | null>(null);
  const received = requests.filter((r) => r.status === 'soumise');
  const open = requests.filter((r) => r.status === 'envoyee' || r.status === 'en_cours');
  const closed = requests.filter((r) => r.status === 'validee' || r.status === 'annulee');
  const quiet = open.length === 0 && received.length === 0 && !link && !creating;

  if (requests.length === 0 && !canManage) return null;

  return (
    <section className="sup-requests" aria-label="Questionnaire au fournisseur">
      <div className="sup-requests-head">
        <p className="drawer-section-label">Questionnaire au fournisseur</p>
        {canManage && quiet ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>Demander au fournisseur de répondre</button> : null}
      </div>
      {canManage && quiet && explain ? (
        <p className="ds-muted sup-request-cta">Envoyez au contact du fournisseur un lien personnel : il répond lui-même au questionnaire, sans compte, puis vous validez sa réponse.</p>
      ) : null}
      {received.map((r) => {
        const answered = Object.keys(r.answers).length;
        const comments = Object.keys(r.comments).length;
        return (
          <div key={r.id} className="sup-response" role="status">
            <span className="grow">
              <b>Réponse reçue le {r.submittedAt ? fmtDay(r.submittedAt) : '—'}</b>
              <small>{r.contactName} · {answered}/{SUPPLIER_QUESTIONS.length} réponses{comments ? ` · ${comments} commentaire${comments > 1 ? 's' : ''}` : ''}</small>
            </span>
            {canManage ? <button type="button" className="btn btn-primary btn-sm" onClick={() => onReview(r)}>Examiner la réponse</button> : <span className="ds-muted">À examiner par un responsable</span>}
          </div>
        );
      })}
      {link ? <PortalLink {...link} onDone={() => setLink(null)} /> : null}
      {open.length > 0 ? (
        <ul className="sup-list">
          {open.map((r) => <OpenRequestRow key={r.id} slug={slug} request={r} canManage={canManage} today={today} onChanged={onChanged} onLink={setLink} />)}
        </ul>
      ) : null}
      {creating ? (
        <RequestForm slug={slug} supplier={supplier} today={today} onCancel={() => setCreating(false)} onCreated={async (l) => { setCreating(false); setLink(l); await onChanged(); }} />
      ) : null}
      {closed.length > 0 ? (
        <details className="sup-requests-history">
          <summary>Demandes précédentes · {closed.length}</summary>
          <ul className="sup-list">
          {closed.map((r) => (
            <li key={r.id}>
              <span className="grow">{r.contactName}<small>Demandée le {fmtDay(r.createdAt)}{r.reviewedAt ? ` · validée le ${fmtDay(r.reviewedAt)}${r.reviewedByName ? ` par ${r.reviewedByName}` : ''}` : ''}</small></span>
              <span className={`sup-request${r.status === 'validee' ? ' sup-request--done' : ''}`}>{SUPPLIER_REQUEST_STATE_LABEL[r.status]}</span>
            </li>
          ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function OpenRequestRow({ slug, request, canManage, today, onChanged, onLink }: { slug: string; request: SupplierRequestRow; canManage: boolean; today: string; onChanged: () => Promise<void>; onLink: (l: { link: string; expiresOn: string; email: string }) => void }) {
  const [mode, setMode] = useState<'idle' | 'renew' | 'cancel'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const state = supplierRequestState(request.status, request.expiresOn, today);
  const late = state !== 'expiree' && request.dueOn < today;

  function renew(fd: FormData) {
    setError(null);
    start(async () => {
      const r = await renewSupplierRequestLinkAction(slug, { requestId: request.id, dueOn: String(fd.get('dueOn') ?? '') });
      if (r.ok) { setMode('idle'); onLink({ ...r.data, email: request.contactEmail }); await onChanged(); } else setError(r.error.message);
    });
  }
  function cancel() {
    setError(null);
    start(async () => {
      const r = await cancelSupplierRequestAction(slug, { requestId: request.id });
      if (r.ok) { setMode('idle'); await onChanged(); } else setError(r.error.message);
    });
  }

  return (
    <li className="sup-open-request">
      <span className="grow">
        {request.contactName}
        <small>{request.contactEmail} · demandée le {fmtDay(request.createdAt)}{request.requestedByName ? ` par ${request.requestedByName}` : ''} · échéance {fmt(request.dueOn)}</small>
        {error ? <small className="form-error" role="alert">{error}</small> : null}
        {mode === 'renew' ? (
          <form className="sup-inline-form" onSubmit={keepValues(renew)}>
            <label className="field">Nouvelle échéance<input type="date" name="dueOn" required min={addDaysIso(today, 1)} max={addDaysIso(today, 90)} defaultValue={request.dueOn > today ? request.dueOn : addDaysIso(today, 14)} /></label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Générer le lien'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('idle')}>Annuler</button>
            <small>L’ancien lien cessera aussitôt de fonctionner.</small>
          </form>
        ) : null}
        {mode === 'cancel' ? (
          <span className="sup-inline-form">
            <small>Le fournisseur ne pourra plus répondre par ce lien.</small>
            <button type="button" className="btn btn-danger btn-sm" onClick={cancel} disabled={pending}>{pending ? 'Annulation…' : 'Annuler la demande'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('idle')}>Garder</button>
          </span>
        ) : null}
      </span>
      <span className={`sup-request${state === 'expiree' || late ? ' sup-request--late' : ''}`}>{late ? 'En retard' : SUPPLIER_REQUEST_STATE_LABEL[state]}</span>
      {canManage && mode === 'idle' ? (
        <span className="sup-request-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('renew')}>Nouveau lien</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('cancel')}>Annuler</button>
        </span>
      ) : null}
    </li>
  );
}

function RequestForm({ slug, supplier, today, onCancel, onCreated }: { slug: string; supplier: SupplierSummary; today: string; onCancel: () => void; onCreated: (l: { link: string; expiresOn: string; email: string }) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    const contactEmail = String(fd.get('contactEmail') ?? '');
    start(async () => {
      const r = await createSupplierRequestAction(slug, {
        supplierId: supplier.id,
        contactName: String(fd.get('contactName') ?? ''),
        contactEmail,
        dueOn: String(fd.get('dueOn') ?? ''),
        message: String(fd.get('message') ?? '') || null,
      });
      if (r.ok) await onCreated({ ...r.data, email: contactEmail.trim() });
      else setError(r.error.message);
    });
  }

  return (
    <form className="sup-request-form" onSubmit={keepValues(submit)}>
      <div className="sup-request-grid">
        <label className="field">Contact chez le fournisseur<input name="contactName" required minLength={2} maxLength={160} placeholder="Service sécurité, responsable qualité…" /></label>
        <label className="field">Adresse e-mail du contact<input name="contactEmail" type="email" required maxLength={254} /></label>
        <label className="field">Réponse attendue avant le<input name="dueOn" type="date" required min={addDaysIso(today, 1)} max={addDaysIso(today, 90)} defaultValue={addDaysIso(today, 21)} /></label>
      </div>
      <label className="field">Message au fournisseur (facultatif)<textarea name="message" rows={3} maxLength={2000} placeholder="Contexte de la demande, contrat concerné, pièces attendues…" /></label>
      <p className="sup-hint">Le lien reste valable deux semaines après l’échéance. Le fournisseur ne voit que le questionnaire, votre message et le nom de votre organisation.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Créer le lien'}</button>
      </div>
    </form>
  );
}

function PortalLink({ link, expiresOn, email, onDone }: { link: string; expiresOn: string; email: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="invite-link" role="status">
      <p><b>Lien prêt pour {email}</b> — transmettez-le par votre messagerie habituelle. Il reste valable jusqu’au {fmt(expiresOn)} et n’est affiché qu’une seule fois.</p>
      <div className="invite-link-row">
        <input value={link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Lien du questionnaire fournisseur" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{copied ? 'Copié' : 'Copier'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Fermer</button>
      </div>
    </div>
  );
}

// ── Attestations ────────────────────────────────────────────────────────

function AttestationsTab({ slug, supplier, detail, canManage, today, onChanged }: { slug: string; supplier: SupplierSummary; detail: SupplierDetail; canManage: boolean; today: string; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add(fd: FormData) {
    setError(null);
    start(async () => {
      const r = await addSupplierAttestationAction(slug, {
        supplierId: supplier.id,
        kind: String(fd.get('kind') ?? ''),
        label: String(fd.get('label') ?? '') || null,
        issuedOn: String(fd.get('issuedOn') ?? '') || null,
        validUntil: String(fd.get('validUntil') ?? '') || null,
      });
      if (r.ok) { setAdding(false); await onChanged(); } else setError(r.error.message);
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const r = await removeSupplierAttestationAction(slug, id);
      if (r.ok) { setConfirming(null); await onChanged(); } else setError(r.error.message);
    });
  }

  return (
    <>
      {detail.attestations.length === 0 ? (
        <p className="ds-muted" style={{ marginBottom: 16 }}>Aucune attestation : certificats, rapports d’audit, assurances ou accord de traitement des données.</p>
      ) : (
        <ul className="sup-list">
          {detail.attestations.map((t) => {
            const state = attestationFreshness(t.validUntil, today);
            return (
              <li key={t.id}>
                <span className="grow">
                  {ATTESTATION_KIND_LABEL[t.kind]}
                  <small>{[t.label, t.issuedOn ? `délivrée le ${fmt(t.issuedOn)}` : null].filter(Boolean).join(' · ') || '—'}</small>
                </span>
                {confirming === t.id ? (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>Annuler</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(t.id)} disabled={pending}>Confirmer le retrait</button>
                  </>
                ) : (
                  <>
                    <span className={`fresh-tag fresh--${state}`}>{t.validUntil ? `${state === 'expiree' ? 'Expirée le' : 'Jusqu’au'} ${fmt(t.validUntil)}` : 'Sans échéance'}</span>
                    {canManage ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(t.id)} aria-label={`Retirer ${ATTESTATION_KIND_LABEL[t.kind]}${t.validUntil ? ` valable jusqu’au ${fmt(t.validUntil)}` : ''}`}>Retirer</button> : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {canManage && !adding ? <div className="dialog-actions"><button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>+ Ajouter une attestation</button></div> : null}
      {adding ? (
        <form onSubmit={keepValues(add)}>
          <p className="drawer-section-label">Nouvelle attestation</p>
          <div className="risk-form-grid">
            <label className="field field--full">Type<select name="kind" required defaultValue="">
              <option value="" disabled>— Choisir —</option>
              {ATTESTATION_KINDS.map((k) => <option key={k} value={k}>{ATTESTATION_KIND_LABEL[k]}</option>)}
            </select></label>
            <label className="field field--full">Précision (périmètre, organisme, référence)<input name="label" maxLength={200} /></label>
            <label className="field">Délivrée le<input type="date" name="issuedOn" /></label>
            <label className="field">Valable jusqu’au<input type="date" name="validUntil" /></label>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Ajout…' : 'Ajouter'}</button>
          </div>
        </form>
      ) : null}
    </>
  );
}

// ── Actions correctives ─────────────────────────────────────────────────

function ActionsTab({ slug, detail, today }: { slug: string; detail: SupplierDetail; today: string }) {
  if (detail.actions.length === 0) {
    return <p className="ds-muted">Aucune action demandée à ce fournisseur. Les écarts de l’évaluation se transforment en actions depuis l’onglet Évaluation.</p>;
  }
  return (
    <ul className="sup-list">
      {detail.actions.map((a) => {
        const late = a.status !== 'termine' && a.dueDate !== null && a.dueDate < today;
        return (
          <li key={a.id}>
            <span className="grow">
              <a href={`/t/${slug}/plan-action?ouvrir=${a.id}`}>{a.title}</a>
              <small>{refCode('ACT', a.id)} · échéance {fmt(a.dueDate)}{late ? ' · en retard' : ''}</small>
            </span>
            <span className={`status-tag st--${late ? 'en_retard' : a.status}`}>{late ? 'En retard' : ACTION_STATUS_LABEL[a.status] ?? a.status}</span>
          </li>
        );
      })}
    </ul>
  );
}
