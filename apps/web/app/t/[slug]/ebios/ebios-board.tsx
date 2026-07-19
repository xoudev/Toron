'use client';

import { EBIOS_WORKSHOPS, KILL_CHAIN_PHASES, LIKELIHOOD_LABEL, SCENARIO_STATUS_LABEL, scenarioStatus, type EbiosLikelihood, type EbiosPhase } from '@toron/core';
import type { EbiosScenarioRow, ExportSummary, ScopeSummary, StudyDetail, StudySummary } from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { refCode } from '@/lib/format';

import { addActionAction, addScenarioAction, createStudyAction, generateRiskAction, getStudyAction, listStudyExportsAction, requestEbiosExportAction, setWorkshopAction } from './ebios-actions';

const STATUS_CLASS: Record<string, string> = { a_faire: 'ouverte', en_cours: 'cloturee_a_verifier', cote: 'efficace' };
const LV_TONE: Record<EbiosLikelihood, string> = { v1: 'var(--text-2)', v2: 'var(--warn)', v3: 'var(--danger)', v4: 'var(--danger)' };

function ExportRow({ slug, exp, onRefresh }: { slug: string; exp: ExportSummary; onRefresh: () => void }) {
  const sealed = exp.status === 'scelle';
  const failed = exp.status === 'echec';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, padding: '3px 0' }}>
      <span className="export-label">Livrable EBIOS RM · format ANSSI</span>
      {sealed ? (
        <>
          <a className="link-btn" href={`/t/${slug}/exports/${exp.id}/pdf`}>Télécharger le PDF scellé</a>
          {exp.verifySlug ? <a className="link-btn" href={`/verifier/${exp.verifySlug}`} target="_blank" rel="noreferrer">Vérifier le poinçon ↗</a> : null}
          {exp.sha256 ? <span className="ds-mono" title={exp.sha256} style={{ color: 'var(--text-2)' }}>{exp.sha256.slice(0, 12)}…</span> : null}
        </>
      ) : failed ? (
        <span style={{ color: 'var(--danger)' }}>Échec de génération</span>
      ) : (
        <><span style={{ color: 'var(--text-2)' }}>Génération en cours…</span><button className="link-btn" onClick={onRefresh}>Actualiser</button></>
      )}
    </div>
  );
}

export function EbiosBoard({ slug, canManage, studies, scopes }: { slug: string; canManage: boolean; studies: StudySummary[]; scopes: ScopeSummary[] }) {
  const router = useRouter();
  const [studyId, setStudyId] = useState<string | null>(studies[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [exports, setExports] = useState<ExportSummary[]>([]);
  const [selScenario, setSelScenario] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const loadExports = (id: string) => listStudyExportsAction(slug, id).then((r) => { if (r.ok) setExports(r.data); });
  const reload = () => { if (studyId) { getStudyAction(slug, studyId).then((r) => { if (r.ok) setDetail(r.data); }); loadExports(studyId); } };
  useEffect(() => {
    let a = true;
    if (studyId) {
      getStudyAction(slug, studyId).then((r) => { if (a && r.ok) { setDetail(r.data); setSelScenario((s) => s ?? r.data.scenarios[0]?.id ?? null); } });
      listStudyExportsAction(slug, studyId).then((r) => { if (a && r.ok) setExports(r.data); });
    } else { setDetail(null); setExports([]); }
    return () => { a = false; };
  }, [slug, studyId]);

  // Auto-actualisation tant qu'un livrable est en cours de génération par le
  // worker (le scellement dure quelques secondes) — le lien apparaît seul.
  const generating = exports.some((e) => e.status === 'en_cours');
  useEffect(() => {
    if (!generating || !studyId) return;
    const timer = setInterval(() => { void loadExports(studyId); }, 2500);
    return () => clearInterval(timer);
  }, [generating, studyId, slug]);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => { const res = await fn(); if (res.ok) { reload(); router.refresh(); } else setError(res.error?.message ?? 'Refusé.'); });
  }

  if (studies.length === 0 && !detail) {
    return (
      <>
        <div className="empty-state"><h2>Aucune étude EBIOS RM</h2><p>Lancez une étude pour dérouler les cinq ateliers de la méthode ANSSI.</p>{canManage ? <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => setCreating(true)}>Lancer une étude</button> : null}</div>
        {creating ? <CreateDialog slug={slug} scopes={scopes} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setStudyId(id); }} /> : null}
      </>
    );
  }

  const scenario = detail?.scenarios.find((s) => s.id === selScenario) ?? null;

  return (
    <>
      <div className="ds-toolbar">
        {studies.length > 0 ? (
          <select value={studyId ?? ''} onChange={(e) => { setStudyId(e.target.value); setSelScenario(null); }} aria-label="Étude EBIOS RM">
            {studies.map((s) => <option key={s.id} value={s.id}>{s.title}{s.scopeName ? ` · ${s.scopeName}` : ''}</option>)}
          </select>
        ) : null}
        <span className="spacer" />
        {detail ? <span className="drawer-section-label" style={{ margin: 0 }}>{detail.ratedCount}/{detail.scenarioCount} scénarios cotés</span> : null}
        {detail && canManage ? <button className="btn btn-primary btn-sm" disabled={pending || exports.some((e) => e.status === 'en_cours')} onClick={() => run(() => requestEbiosExportAction(slug, { studyId: detail.id }))}>{exports.some((e) => e.status === 'en_cours') ? 'Génération…' : 'Exporter le livrable'}</button> : null}
        {canManage ? <button className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>+ Étude</button> : null}
      </div>

      {exports.length > 0 ? (
        <div className="ds-table-card" style={{ padding: '8px 12px', marginBottom: 12 }}>
          {exports.map((e) => <ExportRow key={e.id} slug={slug} exp={e} onRefresh={() => studyId && loadExports(studyId)} />)}
        </div>
      ) : null}

      {detail ? (
        <>
          <div className="eb-stepper">
            {EBIOS_WORKSHOPS.map((w) => (
              <button key={w.num} className="eb-step" aria-current={detail.workshop === w.num} disabled={pending || !canManage} onClick={() => run(() => setWorkshopAction(slug, { studyId: detail.id, workshop: w.num }))}>
                <span className="eb-step-num">{w.num}</span><span className="eb-step-label">{w.label}</span>
              </button>
            ))}
          </div>

          <div className="ds-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 16, alignItems: 'start' }}>
            <div className="ds-table-card" style={{ padding: 8 }}>
              <div className="ds-toolbar" style={{ padding: '4px 6px' }}>
                <span className="drawer-section-label" style={{ margin: 0 }}>Scénarios opérationnels</span>
                <span className="spacer" />
                {canManage ? <ScenarioAdd slug={slug} studyId={detail.id} onDone={reload} /> : null}
              </div>
              {detail.scenarios.map((s) => {
                const st = scenarioStatus({ likelihood: s.likelihood, actionCount: s.actions.length });
                return (
                  <button key={s.id} className="pr-card" style={{ width: '100%', textAlign: 'left', marginBottom: 6, borderColor: s.id === selScenario ? 'var(--text-2)' : undefined }} onClick={() => setSelScenario(s.id)}>
                    <div className="pr-name" style={{ fontSize: 12.5 }}>{s.riskSource}</div>
                    <div className="ds-muted" style={{ fontSize: 11 }}>→ {s.targetObjective}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                      <span className={`nc-status ncs--${STATUS_CLASS[st]}`}>{SCENARIO_STATUS_LABEL[st]}</span>
                      {s.likelihood ? <span className="ds-mono" style={{ color: LV_TONE[s.likelihood], fontWeight: 700 }}>{s.likelihood.toUpperCase()}</span> : null}
                      {s.generatedRiskId ? <span className="ds-id" style={{ marginLeft: 'auto', color: 'var(--ok)' }}>→ registre</span> : null}
                    </div>
                  </button>
                );
              })}
              {detail.scenarios.length === 0 ? <p className="risk-mut-hint" style={{ padding: 6 }}>Aucun scénario. Héritez d’un couple source/objectif de l’atelier 2.</p> : null}
            </div>

            <div className="ds-table-card" style={{ padding: 14 }}>
              {scenario ? <KillChain slug={slug} scenario={scenario} scopeId={detail.scopeId} canManage={canManage} onRun={run} pending={pending} /> : <p className="risk-mut-hint">Sélectionnez un scénario pour construire son mode opératoire.</p>}
            </div>
          </div>
        </>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {creating ? <CreateDialog slug={slug} scopes={scopes} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setStudyId(id); }} /> : null}
    </>
  );
}

function KillChain({ slug, scenario, scopeId, canManage, onRun, pending }: { slug: string; scenario: EbiosScenarioRow; scopeId: string | null; canManage: boolean; onRun: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void; pending: boolean }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span className="ds-id">{refCode('SCN', scenario.id)}</span>
        {scenario.likelihood ? <span className="eb-vrais" style={{ color: LV_TONE[scenario.likelihood] }}><span className="lv">{scenario.likelihood.toUpperCase()}</span>{LIKELIHOOD_LABEL[scenario.likelihood]}</span> : <span className="ds-muted">à construire</span>}
      </div>
      <h2 style={{ margin: '0 0 2px', fontSize: 15 }}>{scenario.riskSource}</h2>
      <div className="ds-muted" style={{ marginBottom: 12 }}>Objectif visé : {scenario.targetObjective} · hérité de l’atelier 2</div>

      <p className="drawer-section-label">Mode opératoire — kill chain</p>
      <div className="eb-killchain">
        {KILL_CHAIN_PHASES.map((ph, i) => {
          const acts = scenario.actions.filter((a) => a.phase === ph.key);
          return (
            <div className="eb-phase" key={ph.key}>
              <p className="eb-phase-head"><span className="eb-phase-n">{i + 1}</span>{ph.label}</p>
              {acts.map((a) => (
                <div className="eb-action" key={a.id}>
                  {a.mitreId ? <div className="eb-action-tech">{a.mitreId} · {a.mitreName}</div> : null}
                  <div className="eb-action-label">{a.label}</div>
                </div>
              ))}
              {canManage ? <ActionAdd slug={slug} scenarioId={scenario.id} phase={ph.key} onRun={onRun} pending={pending} /> : null}
              {acts.length === 0 && !canManage ? <span className="ds-muted" style={{ fontSize: 11 }}>—</span> : null}
            </div>
          );
        })}
      </div>

      {canManage ? (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          {scenario.generatedRiskId ? (
            <span className="ds-id" style={{ color: 'var(--ok)' }}>Risque généré dans le registre unique ↗</span>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={pending || !scenario.likelihood || !scopeId} title={!scopeId ? 'L’étude doit être rattachée à un périmètre.' : !scenario.likelihood ? 'Construisez la kill chain pour coter le scénario.' : undefined} onClick={() => scopeId ? onRun(() => generateRiskAction(slug, { scenarioId: scenario.id, scopeId })) : undefined}>
              Générer le risque dans le registre
            </button>
          )}
          <span className="risk-mut-hint" style={{ margin: 0 }}>Atelier 5 — le risque rejoint le registre unique (source EBIOS).</span>
        </div>
      ) : null}
    </>
  );
}

function ActionAdd({ slug, scenarioId, phase, onRun, pending }: { slug: string; scenarioId: string; phase: EbiosPhase; onRun: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [tid, setTid] = useState('');
  const [tname, setTname] = useState('');
  if (!open) return <button className="link-btn" style={{ fontSize: 11 }} onClick={() => setOpen(true)}>+ Action</button>;
  return (
    <div style={{ marginTop: 4 }}>
      <input placeholder="Action élémentaire" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: '100%', fontSize: 11, marginBottom: 3 }} />
      <div style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
        <input placeholder="Txxxx" value={tid} onChange={(e) => setTid(e.target.value)} style={{ width: 60, fontSize: 11 }} />
        <input placeholder="Technique" value={tname} onChange={(e) => setTname(e.target.value)} style={{ flex: 1, fontSize: 11, minWidth: 0 }} />
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} disabled={pending || label.trim().length < 2} onClick={() => onRun(async () => { const r = await addActionAction(slug, { scenarioId, phase, label: label.trim(), mitreId: tid.trim() || null, mitreName: tname.trim() || null }); if (r.ok) { setLabel(''); setTid(''); setTname(''); setOpen(false); } return r; })}>Ajouter</button>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setOpen(false)}>×</button>
      </div>
    </div>
  );
}

function ScenarioAdd({ slug, studyId, onDone }: { slug: string; studyId: string; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await addScenarioAction(slug, { studyId, riskSource: String(fd.get('riskSource') ?? ''), targetObjective: String(fd.get('targetObjective') ?? '') });
      if (res.ok) { setOpen(false); onDone(); router.refresh(); } else setError(res.error.message);
    });
  }
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>+ Scénario</button>
      {open ? (
        <Dialog title="Ajouter un scénario opérationnel" onClose={() => setOpen(false)}>
          <form action={submit}>
            <p className="risk-mut-hint">Le couple source de risque / objectif visé est hérité de l’atelier 2.</p>
            <label className="field">Source de risque<input name="riskSource" minLength={2} required placeholder="Cybercriminel organisé" /></label>
            <label className="field">Objectif visé<input name="targetObjective" minLength={2} required placeholder="Rançonner l’entreprise" /></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>Ajouter</button></div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function CreateDialog({ slug, scopes, onClose, onCreated }: { slug: string; scopes: ScopeSummary[]; onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createStudyAction(slug, { title: String(fd.get('title') ?? ''), scopeId: String(fd.get('scopeId') ?? '') || null });
      if (res.ok) { router.refresh(); onCreated(res.data.id); } else setError(res.error.message);
    });
  }
  return (
    <Dialog title="Lancer une étude EBIOS RM" onClose={onClose}>
      <form action={submit}>
        <label className="field">Intitulé<input name="title" minLength={2} required placeholder="SI de production 2026" /></label>
        <label className="field">Périmètre<select name="scopeId" defaultValue={scopes[0]?.id ?? ''}><option value="">—</option>{scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <p className="risk-mut-hint">Les cinq ateliers ANSSI ; les scénarios opérationnels alimentent le registre de risques unique.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Lancer'}</button></div>
      </form>
    </Dialog>
  );
}
