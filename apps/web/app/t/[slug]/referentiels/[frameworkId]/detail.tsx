'use client';

import { scoreAssessment, type AssessmentItemStatus, type ControlDeleteImpact } from '@toron/core';
import type {
  AssessmentItemRow,
  AssessmentSummary,
  ControlLink,
  ControlSummary,
  ExportSummary,
  FrameworkSummary,
  RequirementNode,
  ScopeSummary,
} from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

import {
  createControlAction,
  deleteControlAction,
  getControlDeleteImpactAction,
  mapControlAction,
  unmapControlAction,
} from '../actions';
import { EvaluationPanel } from './evaluation-panel';
import { CampaignBar } from './campaign-bar';

const ASSESSMENT_STATUS_LABEL: Record<AssessmentItemStatus, string> = {
  conforme: 'Conforme',
  ecart: 'Écart',
  non_applicable: 'Non applicable',
  a_evaluer: 'À évaluer',
};
export function assessmentStatusLabel(status: AssessmentItemStatus): string {
  return ASSESSMENT_STATUS_LABEL[status];
}

const FRAMEWORK_BADGE: Record<string, string> = {
  recyf: 'NIS 2',
  iso27001: 'ISO 27001',
  iso9001: 'ISO 9001',
  rgpd: 'RGPD',
};
function badgeLabel(code: string): string {
  return FRAMEWORK_BADGE[code] ?? code.toUpperCase();
}

const STATUS_LABEL: Record<string, string> = {
  actif: 'Actif',
  brouillon: 'Brouillon',
  archive: 'Archivé',
};
function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function sectionOf(ref: string): string {
  if (/^A\./.test(ref)) return 'Annexe A · contrôles';
  if (/^\d+$/.test(ref)) return 'Chapitres · exigences';
  return 'Exigences';
}

interface Props {
  slug: string;
  canManage: boolean;
  framework: FrameworkSummary;
  tree: RequirementNode[];
  controls: ControlSummary[];
  links: ControlLink[];
  scopes: ScopeSummary[];
  assessments: AssessmentSummary[];
  activeCampaign: AssessmentSummary | null;
  items: AssessmentItemRow[];
  exportsList: ExportSummary[];
}

export function ReferentielDetail({
  slug,
  canManage,
  framework,
  tree,
  controls,
  links,
  scopes,
  assessments,
  activeCampaign,
  items,
  exportsList,
}: Props) {
  const itemsByReq = useMemo(
    () => new Map(items.map((i) => [i.requirementId, i])),
    [items],
  );
  const score = useMemo(() => (activeCampaign ? scoreAssessment(items) : null), [activeCampaign, items]);
  const roots = useMemo(() => tree.filter((n) => n.parentId === null), [tree]);
  const childrenByParent = useMemo(() => {
    const m = new Map<string, RequirementNode[]>();
    for (const n of tree) {
      if (n.parentId) {
        const arr = m.get(n.parentId) ?? [];
        arr.push(n);
        m.set(n.parentId, arr);
      }
    }
    return m;
  }, [tree]);
  const controlsById = useMemo(() => new Map(controls.map((c) => [c.id, c])), [controls]);
  const linkedByReq = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) {
      const arr = m.get(l.requirementId) ?? [];
      arr.push(l.controlId);
      m.set(l.requirementId, arr);
    }
    return m;
  }, [links]);

  function otherFrameworks(reqId: string): string[] {
    const codes = new Set<string>();
    for (const cid of linkedByReq.get(reqId) ?? []) {
      for (const code of controlsById.get(cid)?.frameworkCodes ?? []) {
        if (code !== framework.code) codes.add(code);
      }
    }
    return [...codes].sort();
  }

  const [activeNodeId, setActiveNodeId] = useState<string>(roots[0]?.id ?? '');
  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);
  const [mutualizedOnly, setMutualizedOnly] = useState(false);

  const sections = useMemo(() => {
    const bySection = new Map<string, RequirementNode[]>();
    for (const r of roots) {
      const s = sectionOf(r.ref);
      const arr = bySection.get(s) ?? [];
      arr.push(r);
      bySection.set(s, arr);
    }
    return [...bySection.entries()];
  }, [roots]);

  const activeNode = tree.find((n) => n.id === activeNodeId) ?? roots[0];
  const rows = useMemo(() => {
    const children = activeNode ? (childrenByParent.get(activeNode.id) ?? []) : [];
    const list = children.length > 0 ? children : activeNode ? [activeNode] : [];
    if (!mutualizedOnly) return list;
    return list.filter((r) => otherFrameworks(r.id).length > 0);
  }, [activeNode, childrenByParent, mutualizedOnly, links, controls]);

  const selectedReq = selectedReqId ? tree.find((n) => n.id === selectedReqId) ?? null : null;

  return (
    <>
      <div className="detail-head">
        <span className="chip-ref">{framework.code.toUpperCase()}</span>
        <div>
          <h1>{framework.name}</h1>
          <div className="sub">
            {framework.requirementCount} exigences · {framework.mappedControlCount} contrôles rattachés
            {framework.isBuiltin ? ' · référentiel intégré' : ' · référentiel interne'}
          </div>
        </div>
        <div className="detail-head-actions">
          <button
            className="toggle-chip"
            aria-pressed={mutualizedOnly}
            onClick={() => setMutualizedOnly((v) => !v)}
          >
            <span className="thread-start" aria-hidden="true" />
            Mutualisés
          </button>
        </div>
      </div>

      <CampaignBar
        slug={slug}
        canManage={canManage}
        frameworkId={framework.id}
        scopes={scopes}
        assessments={assessments}
        activeCampaign={activeCampaign}
        score={score}
        exportsList={exportsList}
      />

      <div className={`detail-layout ${selectedReq ? '' : 'no-panel'}`}>
        {/* ─── Arbre (maître) ─── */}
        <div className="tree">
          {sections.map(([label, nodes]) => (
            <div key={label}>
              <div className="tree-section-label">{label}</div>
              {nodes.map((n) => {
                const childCount = childrenByParent.get(n.id)?.length ?? 0;
                return (
                  <button
                    key={n.id}
                    className={`tree-node ${n.id === activeNodeId ? 'tree-node--active' : ''}`}
                    onClick={() => {
                      setActiveNodeId(n.id);
                      setSelectedReqId(null);
                    }}
                  >
                    <span className="tree-node-id mono">{n.ref}</span>
                    <span className="tree-node-label">{n.title}</span>
                    <span
                      className={`tree-node-count ${n.mappedControlCount > 0 ? 'has-mapping' : ''}`}
                      title={n.mappedControlCount > 0 ? 'Contient des contrôles rattachés' : undefined}
                    >
                      {n.mappedControlCount > 0 ? (
                        <span className="tree-node-map-dot" aria-hidden="true" />
                      ) : null}
                      {childCount > 0 ? childCount : '·'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* ─── Liste des exigences du nœud actif ─── */}
        <div className="req-list">
          <div className="req-list-head">
            <b>
              <span className="mono" style={{ color: 'var(--text-3)' }}>
                {activeNode?.ref}
              </span>{' '}
              {activeNode?.title}
            </b>
            <div className="meta">
              {rows.length} exigence{rows.length > 1 ? 's' : ''}
              {mutualizedOnly ? ' mutualisée' + (rows.length > 1 ? 's' : '') : ''}
            </div>
          </div>
          {rows.length === 0 ? (
            <p style={{ padding: '20px 16px', color: 'var(--text-3)', fontSize: '12.5px' }}>
              {mutualizedOnly ? 'Aucune exigence mutualisée dans ce nœud.' : 'Aucune exigence dans ce nœud.'}
            </p>
          ) : (
            rows.map((r) => {
              const linkedIds = linkedByReq.get(r.id) ?? [];
              const others = otherFrameworks(r.id);
              const mutualized = others.length > 0;
              const item = itemsByReq.get(r.id);
              return (
                <button
                  key={r.id}
                  className={`req-row ${mutualized ? 'req-row--mutualized' : ''} ${
                    r.id === selectedReqId ? 'req-row--selected' : ''
                  }`}
                  onClick={() => setSelectedReqId(r.id)}
                >
                  <span className="req-thread" aria-hidden="true" />
                  <span className="req-row-id">{r.ref}</span>
                  <span className="req-row-body">
                    <span className="req-row-title">{r.title}</span>
                    {(linkedIds.length > 0 || mutualized || item) ? (
                      <span className="req-row-tags">
                        {item ? (
                          <span className={`status-pill status-pill--${item.status}`}>
                            {assessmentStatusLabel(item.status)}
                          </span>
                        ) : null}
                        {linkedIds.slice(0, 2).map((cid) => (
                          <span className="control-chip" key={cid}>
                            {truncate(controlsById.get(cid)?.title ?? '—', 26)}
                          </span>
                        ))}
                        {linkedIds.length > 2 ? (
                          <span className="control-chip">+{linkedIds.length - 2}</span>
                        ) : null}
                        {mutualized ? (
                          <>
                            <span className="thread-start" aria-hidden="true" />
                            {others.map((code) => (
                              <span className="mut-tag" key={code}>
                                <span className="mut-tag-dot" aria-hidden="true" />
                                {badgeLabel(code)}
                              </span>
                            ))}
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  <span className="req-row-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* ─── Panneau détail : mapping ─── */}
        {selectedReq ? (
          <RequirementPanel
            slug={slug}
            canManage={canManage}
            frameworkId={framework.id}
            requirement={selectedReq}
            linkedControlIds={linkedByReq.get(selectedReq.id) ?? []}
            controls={controls}
            controlsById={controlsById}
            otherFrameworks={otherFrameworks(selectedReq.id)}
            activeCampaign={activeCampaign}
            item={itemsByReq.get(selectedReq.id) ?? null}
            onClose={() => setSelectedReqId(null)}
          />
        ) : null}
      </div>
    </>
  );
}

function RequirementPanel({
  slug,
  canManage,
  frameworkId,
  requirement,
  linkedControlIds,
  controls,
  controlsById,
  otherFrameworks,
  activeCampaign,
  item,
  onClose,
}: {
  slug: string;
  canManage: boolean;
  frameworkId: string;
  requirement: RequirementNode;
  linkedControlIds: string[];
  controls: ControlSummary[];
  controlsById: Map<string, ControlSummary>;
  otherFrameworks: string[];
  activeCampaign: AssessmentSummary | null;
  item: AssessmentItemRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pickId, setPickId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const linkedSet = new Set(linkedControlIds);
  const available = controls.filter((c) => !linkedSet.has(c.id));

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error?.message ?? 'Action impossible.');
    });
  }

  return (
    <aside className="detail-panel">
      <div className="panel-header">
        <div className="panel-header-body">
          <span className="chip-ref">{requirement.ref}</span>
          <div className="panel-title">{requirement.title}</div>
          {requirement.guidance ? <p className="panel-guidance">{requirement.guidance}</p> : null}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer le panneau">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {activeCampaign && activeCampaign.status === 'en_cours' ? (
        <EvaluationPanel
          slug={slug}
          canManage={canManage}
          frameworkId={frameworkId}
          assessmentId={activeCampaign.id}
          requirement={requirement}
          item={item}
        />
      ) : activeCampaign && item ? (
        <div className="panel-section">
          <div className="panel-section-label">Évaluation ({activeCampaign.campaignLabel})</div>
          <span className={`status-pill status-pill--${item.status}`}>
            {assessmentStatusLabel(item.status)}
          </span>
          {item.soaJustification ? (
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)' }}>
              Justification&nbsp;: {item.soaJustification}
            </p>
          ) : null}
          <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>
            Campagne clôturée — statut figé.
          </p>
        </div>
      ) : null}

      {otherFrameworks.length > 0 ? (
        <div className="panel-section">
          <div className="mut-callout">
            <span className="thread-start" aria-hidden="true" />
            <span>
              <b>Exigence mutualisée</b> — les contrôles rattachés couvrent aussi&nbsp;:
            </span>
            {otherFrameworks.map((code) => (
              <span className="mut-tag" key={code}>
                <span className="mut-tag-dot" aria-hidden="true" />
                {badgeLabel(code)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel-section">
        <div className="panel-section-label">Contrôles rattachés ({linkedControlIds.length})</div>
        {linkedControlIds.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: '12px' }}>
            Aucun contrôle rattaché à cette exigence.
          </p>
        ) : (
          linkedControlIds.map((cid) => {
            const c = controlsById.get(cid);
            if (!c) return null;
            return (
              <div className="linked-control" key={cid}>
                <div className="linked-control-body">
                  <div className="linked-control-title">{c.title}</div>
                  <div className="linked-control-meta">
                    <span className={`status-dot status-dot--${c.status}`} aria-hidden="true" />
                    {statusLabel(c.status)} · couvre {c.frameworkCodes.length} référentiel
                    {c.frameworkCodes.length > 1 ? 's' : ''}
                  </div>
                </div>
                {canManage ? (
                  <div className="linked-control-actions">
                    <button
                      className="link-btn"
                      disabled={pending}
                      onClick={() =>
                        run(() => unmapControlAction(slug, { controlId: cid, requirementId: requirement.id }))
                      }
                    >
                      Retirer
                    </button>
                    <button
                      className="link-btn link-btn--danger"
                      disabled={pending}
                      onClick={() => setDeleteTarget({ id: cid, title: c.title })}
                    >
                      Supprimer
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {canManage ? (
        <div className="panel-section">
          <div className="panel-section-label">Rattacher un contrôle</div>
          {available.length > 0 ? (
            <div className="map-picker">
              <select
                aria-label="Contrôle à rattacher"
                value={pickId}
                onChange={(e) => setPickId(e.target.value)}
              >
                <option value="">Choisir un contrôle existant…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost btn-sm"
                disabled={pending || !pickId}
                onClick={() =>
                  run(async () => {
                    const res = await mapControlAction(slug, {
                      controlId: pickId,
                      requirementId: requirement.id,
                    });
                    if (res.ok) setPickId('');
                    return res;
                  })
                }
              >
                Rattacher
              </button>
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <label className="field" style={{ marginBottom: 8 }}>
              Ou créer un contrôle et le rattacher
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex. Revue trimestrielle des accès"
              />
            </label>
            <button
              className="btn btn-primary btn-sm"
              disabled={pending || newTitle.trim().length < 2}
              onClick={() =>
                run(async () => {
                  const res = await createControlAction(slug, {
                    title: newTitle.trim(),
                    requirementId: requirement.id,
                  });
                  if (res.ok) setNewTitle('');
                  return res;
                })
              }
            >
              Créer et rattacher
            </button>
          </div>
          {error ? (
            <p className="form-error" role="alert" style={{ marginTop: 8 }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {deleteTarget ? (
        <DeleteControlDialog
          slug={slug}
          control={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            router.refresh();
          }}
        />
      ) : null}
    </aside>
  );
}

function DeleteControlDialog({
  slug,
  control,
  onClose,
  onDeleted,
}: {
  slug: string;
  control: { id: string; title: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [impact, setImpact] = useState<ControlDeleteImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  // Charge l'impact au montage (RM §5.2 : lister les exigences découvertes).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getControlDeleteImpactAction(slug, control.id);
        if (cancelled) return;
        if (res.ok) setImpact(res.data);
        else setError(res.error.message);
      } catch {
        if (!cancelled) setError('L’analyse de l’impact a échoué — fermez et réessayez.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, control.id]);

  function confirm() {
    setError(null);
    start(async () => {
      const res = await deleteControlAction(slug, { controlId: control.id, confirmed: true });
      if (res.ok) onDeleted();
      else setError(res.error.message);
    });
  }

  return (
    <Dialog title={`Supprimer « ${truncate(control.title, 48)} » ?`} onClose={onClose}>
      {loading ? (
        <p>Analyse de l’impact…</p>
      ) : impact ? (
          <>
            <p>
              Ce contrôle couvre {impact.mappedRequirementCount} exigence
              {impact.mappedRequirementCount > 1 ? 's' : ''}. Sa suppression retirera ces
              rattachements.
              {impact.uncoveredRequirementCount > 0 ? (
                <>
                  {' '}
                  <b>
                    {impact.uncoveredRequirementCount} exigence
                    {impact.uncoveredRequirementCount > 1 ? 's' : ''} ne{' '}
                    {impact.uncoveredRequirementCount > 1 ? 'seront' : 'sera'} plus couverte
                    {impact.uncoveredRequirementCount > 1 ? 's' : ''}.
                  </b>
                </>
              ) : null}
            </p>
            {impact.frameworks.map((fw) => (
              <div className="impact-framework" key={fw.frameworkId}>
                <div className="impact-framework-label">{fw.frameworkName}</div>
                {fw.requirements.map((r) => (
                  <div className="impact-req" key={r.requirementId}>
                    <span className="chip-ref">{r.requirementRef}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{truncate(r.requirementTitle, 40)}</span>
                    {r.becomesUncovered ? <span className="impact-uncovered">DÉCOUVERTE</span> : null}
                  </div>
                ))}
              </div>
            ))}
          </>
        ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={pending}>
          Annuler
        </button>
        <button className="btn btn-danger btn-sm" onClick={confirm} disabled={pending || loading}>
          {pending ? 'Suppression…' : 'Supprimer le contrôle'}
        </button>
      </div>
    </Dialog>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
