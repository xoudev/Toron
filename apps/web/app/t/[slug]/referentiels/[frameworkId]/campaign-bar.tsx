'use client';

import type { CoverageScore } from '@toron/core';
import type { AssessmentSummary, ExportSummary, ScopeSummary } from '@toron/db';
import { Dialog } from '@toron/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createAssessmentAction, requestSoaExportAction } from './assessment-actions';

const SCOPE_KIND_LABEL: Record<string, string> = { smsi: 'SMSI', qms: 'QMS', mixte: 'Mixte' };

function ExportRow({
  slug,
  exp,
  onRefresh,
}: {
  slug: string;
  exp: ExportSummary;
  onRefresh: () => void;
}) {
  const sealed = exp.status === 'scelle';
  const failed = exp.status === 'echec';
  return (
    <div className="export-row">
      <span className="export-label">Déclaration d’applicabilité</span>
      {sealed ? (
        <>
          <a className="link-btn" href={`/t/${slug}/exports/${exp.id}/pdf`}>
            Télécharger le PDF scellé
          </a>
          {exp.verifySlug ? (
            <a className="link-btn" href={`/verifier/${exp.verifySlug}`} target="_blank" rel="noreferrer">
              Vérifier le poinçon ↗
            </a>
          ) : null}
          {exp.sha256 ? (
            <span className="export-hash mono" title={exp.sha256}>
              {exp.sha256.slice(0, 12)}…
            </span>
          ) : null}
        </>
      ) : failed ? (
        <span style={{ color: 'var(--danger)', fontSize: '12px' }}>Échec de génération</span>
      ) : (
        <>
          <span style={{ color: 'var(--text-2)', fontSize: '12px' }}>Génération en cours…</span>
          <button className="link-btn" onClick={onRefresh}>
            Actualiser
          </button>
        </>
      )}
    </div>
  );
}
const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  planifiee: 'planifiée',
  en_cours: 'en cours',
  cloturee: 'clôturée',
};

export function CampaignBar({
  slug,
  canManage,
  frameworkId,
  scopes,
  assessments,
  activeCampaign,
  score,
  exportsList,
}: {
  slug: string;
  canManage: boolean;
  frameworkId: string;
  scopes: ScopeSummary[];
  assessments: AssessmentSummary[];
  activeCampaign: AssessmentSummary | null;
  score: CoverageScore | null;
  exportsList: ExportSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function requestExport() {
    if (!activeCampaign) return;
    setError(null);
    start(async () => {
      const res = await requestSoaExportAction(slug, { frameworkId, assessmentId: activeCampaign.id });
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  function selectCampaign(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('campaign', id);
    else params.delete('campaign');
    router.push(`${pathname}?${params.toString()}`);
  }

  function create(formData: FormData) {
    setError(null);
    start(async () => {
      const res = await createAssessmentAction(slug, {
        frameworkId,
        scopeId: String(formData.get('scopeId') ?? ''),
        campaignLabel: String(formData.get('campaignLabel') ?? ''),
      });
      if (res.ok) {
        setOpen(false);
        router.push(`${pathname}?campaign=${res.data.assessmentId}`);
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="campaign-bar">
      <span className="campaign-bar-label">Évaluation</span>
      {assessments.length > 0 ? (
        <select
          aria-label="Campagne d’évaluation"
          value={activeCampaign?.id ?? ''}
          onChange={(e) => selectCampaign(e.target.value)}
        >
          <option value="">— Aucune campagne sélectionnée —</option>
          {assessments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.campaignLabel} ({CAMPAIGN_STATUS_LABEL[a.status] ?? a.status})
            </option>
          ))}
        </select>
      ) : (
        <span style={{ fontSize: '12.5px', color: 'var(--text-2)' }}>
          Aucune campagne — lancez-en une pour évaluer la conformité.
        </span>
      )}

      {canManage && scopes.length > 0 ? (
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          Lancer une évaluation
        </button>
      ) : null}

      {canManage && activeCampaign ? (
        <button className="btn btn-primary btn-sm" onClick={requestExport} disabled={pending}>
          {pending ? 'Demande…' : 'Exporter la Déclaration d’applicabilité'}
        </button>
      ) : null}

      {activeCampaign && score ? (
        <div className="campaign-metrics">
          <div className="metric">
            <span className="metric-value">{score.scorePct === null ? '—' : `${score.scorePct}%`}</span>
            <span className="metric-label">couverture</span>
          </div>
          <div className="coverage-track" aria-hidden="true">
            <div className="coverage-fill" style={{ width: `${score.scorePct ?? 0}%` }} />
          </div>
          <div className="metric">
            <span className="metric-value gaps">{score.gaps}</span>
            <span className="metric-label">écart{score.gaps > 1 ? 's' : ''}</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="form-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>
          {error}
        </p>
      ) : null}

      {activeCampaign && exportsList.length > 0 ? (
        <div className="campaign-exports">
          {exportsList.map((e) => (
            <ExportRow key={e.id} slug={slug} exp={e} onRefresh={() => router.refresh()} />
          ))}
        </div>
      ) : null}

      {open ? (
        <Dialog title="Lancer une évaluation" onClose={() => setOpen(false)}>
          <form action={create}>
            <p>Une campagne pré-remplit une exigence « à évaluer » par exigence du référentiel.</p>
            <label className="field">
              Intitulé de la campagne
              <input name="campaignLabel" placeholder="Évaluation ISO 27001 — S2 2026" minLength={2} required />
            </label>
            <label className="field">
              Périmètre
              <select name="scopeId" defaultValue={scopes[0]?.id} required>
                {scopes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {SCOPE_KIND_LABEL[s.kind] ?? s.kind}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                {pending ? 'Création…' : 'Lancer'}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
