'use client';

import {
  CONTROL_REVIEW_METHODS,
  CONTROL_REVIEW_METHOD_LABEL,
  CONTROL_REVIEW_RESULTS,
  CONTROL_REVIEW_RESULT_LABEL,
  CONTROL_REVIEW_STATE_LABEL,
  REVIEW_FREQUENCIES,
  REVIEW_FREQUENCY_LABEL,
  dueLabel,
  reviewNeedsCorrection,
  type ControlReviewResult,
  type TemplateCoverageFramework,
} from '@toron/core';
import type { ControlDetail, ControlLibraryRow, TenantMember } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { useOpenItem } from '@/lib/use-open-item';

import { getControlDetailAction, recordControlReviewAction, updateControlAction } from './control-actions';
import {
  ControlTemplatesButton, ControlTemplatesStart, TemplateAdoptionNotice,
  type TemplateAdoptionResult, type TemplateDomainOption, type TemplateOption,
} from './control-templates';

const FRAMEWORK_BADGE: Record<string, string> = { recyf: 'NIS 2', iso27001: 'ISO 27001', iso9001: 'ISO 9001', rgpd: 'RGPD' };
const STATUS_LABEL: Record<string, string> = { brouillon: 'Brouillon', actif: 'Actif', archive: 'Archivé' };

function fmt(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

type View = 'tous' | 'a_adapter' | 'en_retard' | 'bientot' | 'defaillants' | 'jamais' | 'sans_frequence';
const VIEWS: { key: View; label: string; match: (c: ControlLibraryRow) => boolean }[] = [
  { key: 'tous', label: 'Tous', match: () => true },
  { key: 'a_adapter', label: 'À adapter', match: (c) => c.status === 'brouillon' },
  { key: 'en_retard', label: 'Revue en retard', match: (c) => c.status === 'actif' && c.reviewState === 'en_retard' },
  { key: 'bientot', label: 'Revue bientôt due', match: (c) => c.status === 'actif' && c.reviewState === 'bientot' },
  { key: 'defaillants', label: 'Défaillants', match: (c) => c.lastResult !== null && c.lastResult !== 'efficace' },
  { key: 'jamais', label: 'Jamais revus', match: (c) => c.status === 'actif' && c.reviewCount === 0 },
  { key: 'sans_frequence', label: 'Sans fréquence', match: (c) => c.status === 'actif' && c.frequency === null },
];

function ResultChip({ result }: { result: ControlReviewResult }) {
  return <span className={`ctl-result ctl-result--${result}`}>{CONTROL_REVIEW_RESULT_LABEL[result]}</span>;
}

export function ControlLibrary({ slug, today, canManage, canReview, exceptionsEnabled, controls, members, templates }: {
  slug: string; today: string; canManage: boolean; canReview: boolean; exceptionsEnabled: boolean;
  controls: ControlLibraryRow[]; members: TenantMember[];
  templates: { templates: TemplateOption[]; domains: TemplateDomainOption[]; adoptedKeys: string[]; coverage: TemplateCoverageFramework[] };
}) {
  const [view, setView] = useState<View>('tous');
  const [query, setQuery] = useState('');
  const [adoption, setAdoption] = useState<TemplateAdoptionResult | null>(null);
  const onAdopted = (r: TemplateAdoptionResult) => { setAdoption(r); setView('a_adapter'); };
  const [openId, setOpenId] = useOpenItem(controls.map((c) => c.id));
  const open = controls.find((c) => c.id === openId) ?? null;

  const current = VIEWS.find((v) => v.key === view)!;
  const q = query.trim().toLowerCase();
  const shown = controls.filter((c) => current.match(c) && (!q || c.title.toLowerCase().includes(q) || (c.ownerName ?? '').toLowerCase().includes(q)));

  return (
    <>
      <div className="ds-toolbar">
        <div className="view-toggle" role="group" aria-label="Filtrer les contrôles">
          {VIEWS.map((v) => {
            const n = controls.filter(v.match).length;
            if (v.key !== 'tous' && n === 0) return null;
            return <button type="button" key={v.key} aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.label} · {n}</button>;
          })}
        </div>
        {canManage && controls.length > 0 ? <ControlTemplatesButton slug={slug} {...templates} onAdopted={onAdopted} /> : null}
        <div className="ds-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 20.5 20.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un contrôle ou un responsable" aria-label="Rechercher un contrôle" />
        </div>
      </div>

      {adoption ? <TemplateAdoptionNotice result={adoption} onClose={() => setAdoption(null)} /> : null}
      {controls.length === 0 ? (
        <ControlTemplatesStart slug={slug} canManage={canManage} {...templates} onAdopted={onAdopted} />
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 1000 }}>
            <thead><tr>
              <th style={{ minWidth: 300 }}>Contrôle</th><th style={{ width: 160 }}>Responsable</th><th style={{ width: 120 }}>Fréquence</th>
              <th style={{ width: 190 }}>Dernière revue</th><th style={{ width: 190 }}>Prochaine revue</th>
              {exceptionsEnabled ? <th style={{ width: 110 }}>Dérogations</th> : null}
            </tr></thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={exceptionsEnabled ? 6 : 5} className="ds-empty">Aucun contrôle dans cette vue.</td></tr>
              ) : shown.map((c) => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} className={c.status !== 'actif' ? 'ctl-row--inactive' : undefined}>
                  <td>
                    <div className="ds-primary">{c.title}
                      <small>
                        {c.frameworkCodes.length > 0 ? c.frameworkCodes.map((f) => FRAMEWORK_BADGE[f] ?? f.toUpperCase()).join(' · ') : 'Rattaché à aucune exigence'}
                        {c.mutualized ? ' · mutualisé' : ''}
                        {c.status !== 'actif' ? ` · ${STATUS_LABEL[c.status] ?? c.status}` : ''}
                      </small>
                    </div>
                  </td>
                  <td><div className="ds-owner"><span className="ds-avatar">{initials(c.ownerName)}</span><span>{c.ownerName ?? '—'}</span></div></td>
                  <td>{c.frequency ? REVIEW_FREQUENCY_LABEL[c.frequency] : <span className="ds-muted">—</span>}</td>
                  <td>
                    {c.lastReviewedOn && c.lastResult ? <><span className="ds-mono">{fmt(c.lastReviewedOn)}</span> <ResultChip result={c.lastResult} /></> : <span className="ds-muted">Jamais revu</span>}
                  </td>
                  <td>
                    {c.nextReviewOn ? (
                      <><span className="ds-mono">{fmt(c.nextReviewOn)}</span><small className={`ctl-due ctl-due--${c.reviewState}`}>{dueLabel(c.nextReviewOn, today)}</small></>
                    ) : <span className="ds-muted">Sans fréquence</span>}
                  </td>
                  {exceptionsEnabled ? <td>{c.openExceptionCount > 0 ? <span className="ctl-exceptions">{c.openExceptionCount} ouverte{c.openExceptionCount > 1 ? 's' : ''}</span> : <span className="ds-muted">—</span>}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {open ? (
        <ControlDrawer
          key={open.id} slug={slug} today={today} control={open} members={members}
          canManage={canManage} canReview={canReview} exceptionsEnabled={exceptionsEnabled} onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function ControlDrawer({ slug, today, control: c, members, canManage, canReview, exceptionsEnabled, onClose }: {
  slug: string; today: string; control: ControlLibraryRow; members: TenantMember[];
  canManage: boolean; canReview: boolean; exceptionsEnabled: boolean; onClose: () => void;
}) {
  const [detail, setDetail] = useState<ControlDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Les compteurs de la ligne changent après une revue : on relit le détail.
  useEffect(() => {
    let alive = true;
    getControlDetailAction(slug, c.id).then((r) => {
      if (!alive) return;
      if (r.ok) setDetail(r.data); else setLoadError(r.error.message);
    });
    return () => { alive = false; };
  }, [slug, c.id, c.reviewCount, c.lastReviewedOn]);

  const header = (
    <>
      <span className="ds-id" id="ctl-title">Contrôle</span>
      {c.status === 'actif' ? <span className={`ctl-state ctl-state--${c.reviewState}`}>{CONTROL_REVIEW_STATE_LABEL[c.reviewState]}</span> : <span className="ds-chip">{STATUS_LABEL[c.status] ?? c.status}</span>}
    </>
  );

  const byFramework = new Map<string, { ref: string; title: string }[]>();
  for (const r of detail?.requirements ?? []) {
    const list = byFramework.get(r.frameworkName) ?? [];
    list.push({ ref: r.ref, title: r.title });
    byFramework.set(r.frameworkName, list);
  }

  return (
    <Drawer header={header} labelId="ctl-title" onClose={onClose}>
      <div className="drawer-wide">
      <div className="drawer-section">
        <h2 className="ctl-title">{c.title}</h2>
        {c.description ? <p className="ctl-text">{c.description}</p> : null}
        <dl className="ctl-facts">
          <div><dt>Responsable</dt><dd>{c.ownerName ?? 'Non attribué'}</dd></div>
          <div><dt>Fréquence de revue</dt><dd>{c.frequency ? REVIEW_FREQUENCY_LABEL[c.frequency] : 'Aucune — le contrôle n’est jamais relancé'}</dd></div>
          <div><dt>Dernière revue</dt><dd>{c.lastReviewedOn && c.lastResult ? <>{fmt(c.lastReviewedOn)} · <ResultChip result={c.lastResult} /></> : 'Jamais revu'}</dd></div>
          {c.nextReviewOn ? <div><dt>Prochaine revue</dt><dd>{fmt(c.nextReviewOn)} · <span className={`ctl-due ctl-due--${c.reviewState}`}>{dueLabel(c.nextReviewOn, today)}</span></dd></div> : null}
        </dl>
        <div className="ctl-actions">
          {canReview && c.status === 'actif' && !reviewing ? <button type="button" className="btn btn-primary btn-sm" onClick={() => { setReviewing(true); setEditing(false); }}>Consigner une revue</button> : null}
          {canManage && !editing ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(true); setReviewing(false); }}>Modifier la fiche</button> : null}
        </div>
      </div>

      {notice ? <p className="ctl-notice" role="status">{notice}</p> : null}
      {reviewing && detail ? <ReviewForm slug={slug} today={today} control={c} evidences={detail.evidences} onDone={(message) => { setReviewing(false); setNotice(message ?? null); }} /> : null}
      {editing ? <ControlForm slug={slug} control={c} members={members} onDone={() => setEditing(false)} /> : null}
      {loadError ? <p className="form-error" role="alert">{loadError}</p> : null}
      {detail === null && !loadError ? <p className="ds-muted">Chargement…</p> : null}

      {detail ? (
        <>
          <div className="drawer-section">
            <p className="drawer-section-label">Revues d’efficacité ({detail.reviews.length})</p>
            {detail.reviews.length === 0 ? (
              <p className="ds-muted">Aucune revue consignée : rien ne démontre encore que ce contrôle fonctionne.</p>
            ) : (
              <ol className="ctl-reviews">
                {detail.reviews.map((r) => (
                  <li key={r.id} className={`ctl-reviews--${r.result}`}>
                    <div className="ctl-review-head">
                      <b>{fmt(r.reviewedOn)}</b> <ResultChip result={r.result} />
                      <span className="ds-muted"> · {CONTROL_REVIEW_METHOD_LABEL[r.method]} · {r.reviewerName ?? '—'}{r.reviewerUserId === c.ownerUserId ? ' (responsable du contrôle)' : ''}</span>
                    </div>
                    {r.observations ? <p className="ctl-text">{r.observations}</p> : null}
                    {r.evidenceId ? <a className="ctl-link" href={`/t/${slug}/preuves?ouvrir=${r.evidenceId}`}>Preuve : {r.evidenceTitle ?? 'consulter'}</a> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="drawer-section">
            <p className="drawer-section-label">Exigences couvertes ({detail.requirements.length})</p>
            {detail.requirements.length === 0 ? <p className="ds-muted">Rattaché à aucune exigence : ce contrôle ne compte pour aucun référentiel.</p> : (
              [...byFramework.entries()].map(([fw, reqs]) => (
                <div key={fw} className="ctl-coverage">
                  <p className="ctl-coverage-fw">{fw}</p>
                  <ul>{reqs.map((r) => <li key={r.ref}><span className="ds-mono">{r.ref}</span> {r.title}</li>)}</ul>
                </div>
              ))
            )}
          </div>

          {detail.risks.length > 0 ? (
            <div className="drawer-section">
              <p className="drawer-section-label">Risques atténués ({detail.risks.length})</p>
              <ul className="ctl-links">{detail.risks.map((r) => <li key={r.id}><a className="ctl-link" href={`/t/${slug}/risques?ouvrir=${r.id}`}>{refCode('RSK', r.id)} · {r.title}</a></li>)}</ul>
            </div>
          ) : null}

          {exceptionsEnabled && detail.exceptions.length > 0 ? (
            <div className="drawer-section">
              <p className="drawer-section-label">Dérogations ({detail.exceptions.length})</p>
              <ul className="ctl-links">{detail.exceptions.map((e) => <li key={e.id}><a className="ctl-link" href={`/t/${slug}/derogations?ouvrir=${e.id}`}>{refCode('DRG', e.id)} · {e.title}</a> <span className="ds-muted">— {e.status === 'demandee' ? 'demandée' : 'accordée'} jusqu’au {fmt(e.expiresOn)}</span></li>)}</ul>
            </div>
          ) : null}

          <div className="drawer-section">
            <p className="drawer-section-label">Preuves rattachées ({detail.evidences.length})</p>
            {detail.evidences.length === 0 ? <p className="ds-muted">Aucune preuve rattachée à ce contrôle dans le coffre.</p> : (
              <ul className="ctl-links">{detail.evidences.map((e) => <li key={e.id}><a className="ctl-link" href={`/t/${slug}/preuves?ouvrir=${e.id}`}>{e.title}</a> <span className="ds-muted">— collectée le {fmt(e.collectedAt)}{e.validUntil ? `, valable jusqu’au ${fmt(e.validUntil)}` : ''}</span></li>)}</ul>
            )}
          </div>
        </>
      ) : null}
      </div>
    </Drawer>
  );
}

function ReviewForm({ slug, today, control, evidences, onDone }: {
  slug: string; today: string; control: ControlLibraryRow; evidences: ControlDetail['evidences']; onDone: (message?: string) => void;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ControlReviewResult>('efficace');
  const [openAction, setOpenAction] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const failing = reviewNeedsCorrection(result);

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const r = await recordControlReviewAction(slug, {
        controlId: control.id,
        reviewedOn: String(fd.get('reviewedOn') ?? ''),
        method: String(fd.get('method') ?? ''),
        result,
        observations: String(fd.get('observations') ?? '') || null,
        evidenceId: String(fd.get('evidenceId') ?? '') || null,
        openAction: failing && openAction,
      });
      if (r.ok) {
        router.refresh();
        onDone(r.data.actionId ? 'Revue consignée. L’action corrective est ouverte dans le plan d’action.' : 'Revue consignée.');
      } else setError(r.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)} className="drawer-section ctl-review-form">
      <p className="drawer-section-label">Nouvelle revue d’efficacité</p>
      <div className="risk-form-grid">
        <label className="field">Date de la revue<input type="date" name="reviewedOn" required max={today} defaultValue={today} /></label>
        <label className="field">Méthode
          <select name="method" defaultValue="echantillonnage">{CONTROL_REVIEW_METHODS.map((m) => <option key={m} value={m}>{CONTROL_REVIEW_METHOD_LABEL[m]}</option>)}</select>
        </label>
      </div>
      <fieldset className="ctl-result-picker">
        <legend>Résultat</legend>
        {CONTROL_REVIEW_RESULTS.map((r) => (
          <label key={r} className={`ctl-result-option ctl-result-option--${r}`}>
            <input type="radio" name="result" value={r} checked={result === r} onChange={() => setResult(r)} />
            {CONTROL_REVIEW_RESULT_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <label className="field">{failing ? 'Ce qui ne fonctionne pas' : 'Observations (facultatif)'}
        <textarea name="observations" rows={3} maxLength={4000} required={failing} minLength={failing ? 10 : undefined}
          placeholder={failing ? 'Échantillon testé, écarts constatés, cause probable…' : 'Échantillon testé, éléments vérifiés…'} />
      </label>
      {evidences.length > 0 ? (
        <label className="field">Preuve à l’appui
          <select name="evidenceId" defaultValue=""><option value="">— Aucune —</option>{evidences.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
        </label>
      ) : null}
      {failing ? (
        <label className="ctl-checkbox">
          <input type="checkbox" checked={openAction} onChange={(e) => setOpenAction(e.target.checked)} />
          Ouvrir une action corrective ({result === 'inefficace' ? 'P1, échéance à 30 jours' : 'P2, échéance à 60 jours'}), confiée à {control.ownerName ?? 'vous-même'}
        </label>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDone()}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : 'Consigner la revue'}</button>
      </div>
    </form>
  );
}

function ControlForm({ slug, control, members, onDone }: { slug: string; control: ControlLibraryRow; members: TenantMember[]; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const r = await updateControlAction(slug, {
        controlId: control.id,
        title: String(fd.get('title') ?? ''),
        description: String(fd.get('description') ?? '') || null,
        ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
        reviewFrequency: String(fd.get('reviewFrequency') ?? '') || null,
        status: String(fd.get('status') ?? 'actif'),
      });
      if (r.ok) { router.refresh(); onDone(); } else setError(r.error.message);
    });
  }

  return (
    <form onSubmit={keepValues(submit)} className="drawer-section">
      <p className="drawer-section-label">Fiche du contrôle</p>
      <label className="field">Intitulé<input name="title" required minLength={2} maxLength={200} defaultValue={control.title} /></label>
      <label className="field">Description<textarea name="description" rows={3} maxLength={4000} defaultValue={control.description ?? ''} placeholder="Ce que le contrôle vérifie, comment et sur quel périmètre…" /></label>
      <div className="risk-form-grid">
        <label className="field">Responsable
          <select name="ownerUserId" defaultValue={control.ownerUserId ?? ''}><option value="">— Non attribué —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
        </label>
        <label className="field">Fréquence de revue
          <select name="reviewFrequency" defaultValue={control.frequency ?? ''}><option value="">Aucune</option>{REVIEW_FREQUENCIES.map((f) => <option key={f} value={f}>{REVIEW_FREQUENCY_LABEL[f]}</option>)}</select>
        </label>
        <label className="field">Statut
          <select name="status" defaultValue={control.status}>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Annuler</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </form>
  );
}
