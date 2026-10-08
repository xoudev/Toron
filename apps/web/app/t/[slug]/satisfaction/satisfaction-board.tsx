'use client';

import {
  SURVEY_METHODS,
  SURVEY_METHOD_LABEL,
  SURVEY_VERDICT_LABEL,
  formatSurveyScore as formatScore,
  surveyError,
  type SurveyMethod,
} from '@toron/core';
import type { ComplaintRow, CustomerSurveyRow, TenantMember } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type KeyboardEvent } from 'react';

import { frDate } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { useOpenItem } from '@/lib/use-open-item';

import { createEvidenceAction } from '../preuves/evidence-actions';
import {
  attachSurveyReportAction,
  createCustomerSurveyAction,
  deleteCustomerSurveyAction,
  updateCustomerSurveyAction,
} from './satisfaction-actions';

type Lite = { id: string; label: string };

const TREND_LABEL = { hausse: 'en hausse', baisse: 'en baisse', stable: 'stable' } as const;
const NC_STATUS_LABEL: Record<string, string> = {
  ouverte: 'Ouverte', en_traitement: 'En traitement', cloturee_a_verifier: 'Efficacité à vérifier', efficace: 'Traitée', rouverte: 'Rouverte',
};
const MONTH_LABEL = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function onEnter(e: KeyboardEvent<HTMLTableRowElement>, open: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open();
  }
}

export function SatisfactionBoard({ slug, today, userId, canManage, surveys, complaints, months, ncEnabled, members, evidences }: {
  slug: string; today: string; userId: string; canManage: boolean; surveys: CustomerSurveyRow[]; complaints: ComplaintRow[];
  months: { month: string; count: number }[]; ncEnabled: boolean; members: TenantMember[]; evidences: Lite[];
}) {
  const [openId, setOpenId] = useOpenItem(surveys.map((s) => s.id));
  const [creating, setCreating] = useState(false);
  const open = surveys.find((s) => s.id === openId) ?? null;
  const max = Math.max(1, ...months.map((m) => m.count));

  return (
    <>
      <section className="card sat-complaints" aria-labelledby="sat-complaints-title">
        <div className="sat-complaints-head">
          <h2 id="sat-complaints-title">Réclamations sur douze mois</h2>
          <p>Les non-conformités de source « réclamation client », par mois d’ouverture.</p>
        </div>
        <div className="sat-bars" role="img" aria-label={`Réclamations par mois : ${months.map((m) => `${m.count}`).join(', ')}`}>
          {months.map((m) => (
            <div key={m.month} className="sat-bar">
              <span className="sat-bar-value">{m.count > 0 ? m.count : ''}</span>
              <span className="sat-bar-fill" style={{ height: `${(m.count / max) * 100}%` }} />
              <span className="sat-bar-label">{MONTH_LABEL[Number(m.month.slice(5, 7)) - 1]}</span>
            </div>
          ))}
        </div>
        {complaints.length === 0 ? <p className="ds-muted">Aucune réclamation sur la période.</p> : (
          <ul className="sat-complaint-list">
            {complaints.map((c) => (
              <li key={c.id}>
                {ncEnabled ? <a className="sat-link" href={`/t/${slug}/non-conformites?ouvrir=${c.id}`}>{c.title}</a> : <span>{c.title}</span>}
                <span className="ds-muted"> — {frDate(c.openedOn)}, {c.gravity}</span>
                <span className={`sat-pill sat-pill--${c.status === 'efficace' ? 'atteint' : c.status === 'ouverte' || c.status === 'rouverte' ? 'sous_objectif' : 'sans_objectif'}`}>{NC_STATUS_LABEL[c.status] ?? c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="ds-toolbar">
        <h2 className="sat-section-title">Enquêtes de satisfaction</h2>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Consigner une enquête</button> : null}
      </div>

      {surveys.length === 0 ? (
        <div className="empty-state">
          <h2>Aucune enquête consignée</h2>
          <p>
            Consignez les résultats de vos baromètres NPS ou de vos questionnaires de satisfaction (CSAT), avec leur
            objectif : Toron calcule le score, la tendance d’une mesure à l’autre et l’écart à l’objectif.
          </p>
        </div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table sat-table" style={{ minWidth: 860 }}>
            <thead><tr>
              <th style={{ width: 104 }}>Clôture</th><th style={{ minWidth: 300 }}>Enquête</th><th style={{ width: 120 }}>Répondants</th>
              <th style={{ width: 150 }}>Score</th><th style={{ width: 160 }}>Objectif</th>
            </tr></thead>
            <tbody>
              {surveys.map((s) => (
                <tr key={s.id} tabIndex={0} onClick={() => setOpenId(s.id)} onKeyDown={(e) => onEnter(e, () => setOpenId(s.id))}>
                  <td className="sat-num">{frDate(s.closedOn)}</td>
                  <td><div className="ds-primary">{s.title}<small>{[SURVEY_METHOD_LABEL[s.method], s.segment].filter(Boolean).join(' · ')}</small></div></td>
                  <td className="sat-num">{s.respondents}{s.invitedCount ? <small className="sat-sub">sur {s.invitedCount} sollicités</small> : null}</td>
                  <td>
                    <span className="sat-score">{formatScore(s.method, s.score)}</span>
                    {s.trend ? <small className={`sat-sub sat-trend--${s.trend}`}>{TREND_LABEL[s.trend]} ({formatScore(s.method, s.previousScore!)} avant)</small> : null}
                  </td>
                  <td>
                    <span className={`sat-pill sat-pill--${s.verdict}`}>{SURVEY_VERDICT_LABEL[s.verdict]}</span>
                    {s.target !== null ? <small className="sat-sub">cible {formatScore(s.method, s.target)}</small> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? (
        <Drawer header={<><span className="ds-id" id="sat-new">Nouvelle enquête</span><span className="ds-chip">Satisfaction</span></>} labelId="sat-new" onClose={() => setCreating(false)}>
          <div className="drawer-wide">
            <SurveyForm slug={slug} today={today} userId={userId} members={members} evidences={evidences}
              onDone={(id) => { setCreating(false); setOpenId(id); }} onCancel={() => setCreating(false)} />
          </div>
        </Drawer>
      ) : null}
      {open ? (
        <SurveyDrawer key={open.id} slug={slug} today={today} userId={userId} canManage={canManage} survey={open}
          members={members} evidences={evidences} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

function SurveyDrawer({ slug, today, userId, canManage, survey: s, members, evidences, onClose }: {
  slug: string; today: string; userId: string; canManage: boolean; survey: CustomerSurveyRow; members: TenantMember[]; evidences: Lite[]; onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const header = (
    <>
      <span className="ds-id" id="sat-title">{frDate(s.closedOn)}</span>
      <span className={`sat-pill sat-pill--${s.verdict}`}>{SURVEY_VERDICT_LABEL[s.verdict]}</span>
    </>
  );

  if (editing) {
    return (
      <Drawer header={header} labelId="sat-title" onClose={onClose}>
        <div className="drawer-wide">
          <p className="drawer-section-label">Modifier l’enquête</p>
          <SurveyForm slug={slug} today={today} userId={userId} members={members} evidences={evidences} survey={s}
            onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer header={header} labelId="sat-title" onClose={onClose}>
      <div className="drawer-section">
        <h2 className="sat-title">{s.title}</h2>
        <p className="sat-big">
          <span className="sat-score">{formatScore(s.method, s.score)}</span>
          {s.target !== null ? <span className="ds-muted"> pour un objectif de {formatScore(s.method, s.target)}</span> : null}
        </p>
        <dl className="sat-facts">
          <div><dt>Méthode</dt><dd>{SURVEY_METHOD_LABEL[s.method]}</dd></div>
          {s.segment ? <div><dt>Segment</dt><dd>{s.segment}</dd></div> : null}
          <div><dt>Répondants</dt><dd>{s.respondents}{s.invitedCount ? ` sur ${s.invitedCount} sollicités (${Math.round((100 * s.respondents) / s.invitedCount)}\u202f%)` : ''}</dd></div>
          {s.method === 'nps' ? (
            <div><dt>Répartition</dt><dd>{s.promoters} promoteurs · {s.passives} passifs · {s.detractors} détracteurs</dd></div>
          ) : (
            <div><dt>Satisfaits</dt><dd>{s.satisfied} sur {s.respondents}</dd></div>
          )}
          {s.trend ? <div><dt>Tendance</dt><dd className={`sat-trend--${s.trend}`}>{TREND_LABEL[s.trend]}, {formatScore(s.method, s.previousScore!)} à la mesure précédente</dd></div> : null}
          <div><dt>Responsable</dt><dd>{s.ownerName ?? '—'}</dd></div>
        </dl>
      </div>

      {s.findings ? (
        <div className="drawer-section">
          <p className="drawer-section-label">Enseignements</p>
          <p className="sat-text">{s.findings}</p>
        </div>
      ) : null}

      <div className="drawer-section">
        <p className="drawer-section-label">Rapport</p>
        {s.evidenceId ? (
          <a className="sat-link" href={`/t/${slug}/preuves?ouvrir=${s.evidenceId}`}>{s.evidenceTitle ?? 'Consulter la preuve'}</a>
        ) : canManage ? <ReportUpload slug={slug} survey={s} /> : <p className="ds-muted">Aucun rapport au coffre.</p>}
      </div>

      {canManage ? (
        <div className="drawer-section sat-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Modifier</button>
          {confirming ? (
            <div className="sat-confirm" role="group" aria-label="Confirmer la suppression">
              <p>Supprimer « {s.title} » ? Ses résultats quittent le registre ; le rapport reste au coffre de preuves. Le journal d’audit garde la trace de la suppression.</p>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <div className="dialog-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Annuler</button>
                <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => start(async () => {
                  const r = await deleteCustomerSurveyAction(slug, { surveyId: s.id });
                  if (r.ok) { onClose(); router.refresh(); } else setError(r.error.message);
                })}>{pending ? 'Suppression…' : 'Supprimer l’enquête'}</button>
              </div>
            </div>
          ) : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>Supprimer</button>}
        </div>
      ) : null}
    </Drawer>
  );
}

function ReportUpload({ slug, survey }: { slug: string; survey: CustomerSurveyRow }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    fd.set('type', 'rapport');
    fd.set('collectedAt', survey.closedOn);
    fd.set('recurrence', 'ponctuelle');
    start(async () => {
      const created = await createEvidenceAction(slug, fd);
      if (!created.ok) {
        setError(created.error.message);
        return;
      }
      const attached = await attachSurveyReportAction(slug, { surveyId: survey.id, evidenceId: created.data.evidenceId });
      if (!attached.ok) setError(`${attached.error.message} Le fichier est bien au coffre de preuves : choisissez-le depuis « Modifier ».`);
      router.refresh();
    });
  }

  return (
    <form className="sat-upload" onSubmit={keepValues(submit)}>
      <label className="field">Intitulé
        <input name="title" required minLength={2} maxLength={200} defaultValue={`Rapport — ${survey.title}`.slice(0, 200)} />
      </label>
      <label className="field">Fichier (PDF, image, tableur ou document, 10 Mo au plus)
        <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.docx,.txt" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Dépôt…' : 'Déposer au coffre et rattacher'}</button>
      </div>
      <p className="sat-hint">Le fichier est haché (SHA-256) et analysé par l’antivirus avant d’entrer au coffre de preuves. Pas de réponse nominative : déposez le rapport agrégé.</p>
    </form>
  );
}

function SurveyForm({ slug, today, userId, members, evidences, survey, onDone, onCancel }: {
  slug: string; today: string; userId: string; members: TenantMember[]; evidences: Lite[]; survey?: CustomerSurveyRow;
  onDone: (id: string) => void; onCancel: () => void;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<SurveyMethod>(survey?.method ?? 'nps');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reportOptions = survey?.evidenceId && !evidences.some((e) => e.id === survey.evidenceId)
    ? [{ id: survey.evidenceId, label: survey.evidenceTitle ?? 'Preuve rattachée' }, ...evidences]
    : evidences;

  function submit(fd: FormData) {
    setError(null);
    const text = (name: string) => String(fd.get(name) ?? '').trim();
    const num = (name: string) => (text(name) === '' ? null : Number(text(name)));
    const input = {
      title: text('title'),
      method,
      segment: text('segment') || null,
      closedOn: text('closedOn'),
      invitedCount: num('invitedCount'),
      respondents: Number(text('respondents') || 0),
      promoters: method === 'nps' ? num('promoters') : null,
      passives: method === 'nps' ? num('passives') : null,
      detractors: method === 'nps' ? num('detractors') : null,
      satisfied: method === 'csat' ? num('satisfied') : null,
      target: num('target'),
      findings: text('findings') || null,
      evidenceId: text('evidenceId') || null,
      ownerUserId: text('ownerUserId') || null,
    };
    const ruleError = surveyError(input, today);
    if (ruleError) {
      setError(ruleError);
      return;
    }
    start(async () => {
      if (survey) {
        const r = await updateCustomerSurveyAction(slug, { surveyId: survey.id, ...input });
        if (r.ok) { router.refresh(); onDone(survey.id); } else setError(r.error.message);
        return;
      }
      const r = await createCustomerSurveyAction(slug, input);
      if (r.ok) { router.refresh(); onDone(r.data.surveyId); } else setError(r.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)}>
      <label className="field">Intitulé
        <input name="title" required minLength={2} maxLength={200} defaultValue={survey?.title ?? ''} placeholder="Baromètre NPS — clients e-commerce, second semestre 2026" />
      </label>
      <div className="risk-form-grid">
        <label className="field">Méthode
          <select value={method} onChange={(e) => setMethod(e.target.value as SurveyMethod)}>
            {SURVEY_METHODS.map((m) => <option key={m} value={m}>{SURVEY_METHOD_LABEL[m]}</option>)}
          </select>
        </label>
        <label className="field">Segment de clientèle
          <input name="segment" maxLength={200} defaultValue={survey?.segment ?? ''} placeholder="Clients e-commerce" />
        </label>
        <label className="field">Date de clôture
          <input name="closedOn" type="date" required max={today} defaultValue={survey?.closedOn ?? today} />
        </label>
        <label className="field">Responsable
          <select name="ownerUserId" defaultValue={survey?.ownerUserId ?? userId}>
            <option value="">— Aucun —</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.userId === userId ? ' (vous)' : ''}</option>)}
          </select>
        </label>
        <label className="field">Personnes sollicitées
          <input name="invitedCount" type="number" min={0} step={1} inputMode="numeric" defaultValue={survey?.invitedCount ?? ''} />
        </label>
        <label className="field">Répondants
          <input name="respondents" type="number" required min={1} step={1} inputMode="numeric" defaultValue={survey?.respondents ?? ''} />
        </label>
      </div>
      <div className="sat-results">
        {method === 'nps' ? (
          <div className="sat-results-grid">
            <label className="field">Promoteurs (9-10)
              <input name="promoters" type="number" required min={0} step={1} inputMode="numeric" defaultValue={survey?.promoters ?? ''} />
            </label>
            <label className="field">Passifs (7-8)
              <input name="passives" type="number" required min={0} step={1} inputMode="numeric" defaultValue={survey?.passives ?? ''} />
            </label>
            <label className="field">Détracteurs (0-6)
              <input name="detractors" type="number" required min={0} step={1} inputMode="numeric" defaultValue={survey?.detractors ?? ''} />
            </label>
            <label className="field">Objectif NPS (-100 à 100)
              <input name="target" type="number" min={-100} max={100} step={1} defaultValue={survey?.target ?? ''} />
            </label>
          </div>
        ) : (
          <div className="sat-results-grid">
            <label className="field">Répondants satisfaits (4 ou 5 sur 5)
              <input name="satisfied" type="number" required min={0} step={1} inputMode="numeric" defaultValue={survey?.satisfied ?? ''} />
            </label>
            <label className="field">Objectif (% de satisfaits)
              <input name="target" type="number" min={0} max={100} step={1} defaultValue={survey?.target ?? ''} />
            </label>
          </div>
        )}
      </div>
      <label className="field">Enseignements
        <textarea name="findings" rows={3} maxLength={4000} defaultValue={survey?.findings ?? ''} placeholder="Principaux irritants, verbatims anonymisés, pistes d’amélioration…" />
      </label>
      <label className="field">Rapport (coffre de preuves)
        <select name="evidenceId" defaultValue={survey?.evidenceId ?? ''}>
          <option value="">— Aucun pour l’instant —</option>
          {reportOptions.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : survey ? 'Enregistrer' : 'Consigner l’enquête'}</button>
      </div>
    </form>
  );
}
