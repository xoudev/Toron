'use client';

import { soaExportReady, type CoverageScore, type RecyfEntityKind } from '@toron/core';
import type { AssessmentSummary, ExportSummary, ScopeSummary } from '@toron/db';
import { Dialog } from '@toron/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { keepValues } from '@/lib/forms';

import { closeAssessmentAction, createAssessmentAction, requestSoaExportAction } from './assessment-actions';

const SCOPE_KIND_LABEL: Record<string, string> = { smsi: 'SMSI', qms: 'QMS', mixte: 'Mixte' };

// Heure de Paris : le rendu serveur et le navigateur affichent la même date.
const EXPORT_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function ExportRow({
  slug,
  canManage,
  exp,
  pending,
  onRefresh,
  onRetry,
}: {
  slug: string;
  canManage: boolean;
  exp: ExportSummary;
  pending: boolean;
  onRefresh: () => void;
  onRetry: () => void;
}) {
  const sealed = exp.status === 'scelle';
  const failed = exp.status === 'echec';
  return (
    <div className="export-row">
      <span className="export-label">
        Déclaration d’applicabilité du {EXPORT_DATE.format(new Date(exp.sealedAt ?? exp.createdAt))}
      </span>
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
        // Relancer est réservé aux responsables (requestSoaExportAction).
        canManage ? (
          <>
            <span style={{ color: 'var(--danger)', fontSize: '12px' }}>
              Échec de génération — relancez l’export ; si cela persiste, contactez le support.
            </span>
            <button className="link-btn" onClick={onRetry} disabled={pending}>
              Relancer
            </button>
          </>
        ) : (
          <span style={{ color: 'var(--danger)', fontSize: '12px' }}>
            Échec de génération — demandez à un responsable de relancer l’export.
          </span>
        )
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
  frameworkCode,
  nis2Default,
  scopes,
  assessments,
  activeCampaign,
  score,
  exportsList,
}: {
  slug: string;
  canManage: boolean;
  frameworkId: string;
  frameworkCode: string;
  nis2Default: RecyfEntityKind | null;
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
  const [confirmExport, setConfirmExport] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Une campagne déjà en cours : en ouvrir une autre doit rester un choix explicite.
  const ongoing = assessments.find((a) => a.status === 'en_cours') ?? null;
  // Rien d'évalué (les pré-exclusions ne comptent pas) : le PDF scellé ne
  // contiendrait que des « à évaluer ».
  const nothingAssessed = score !== null && !soaExportReady(score);
  const toAssess = score?.counts.a_evaluer ?? 0;

  function requestExport() {
    if (!activeCampaign) return;
    setError(null);
    start(async () => {
      const res = await requestSoaExportAction(slug, { frameworkId, assessmentId: activeCampaign.id });
      if (res.ok) {
        setConfirmExport(false);
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  function closeCampaign() {
    if (!activeCampaign) return;
    setError(null);
    start(async () => {
      const res = await closeAssessmentAction(slug, { frameworkId, assessmentId: activeCampaign.id });
      if (res.ok) {
        setConfirmClose(false);
        // La campagne reste affichée, figée, une fois clôturée.
        selectCampaign(activeCampaign.id);
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  function selectCampaign(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('campaign', id);
    router.push(`${pathname}?${params.toString()}`);
  }

  function create(formData: FormData) {
    setError(null);
    start(async () => {
      const nis2Entity = formData.get('nis2Entity');
      const res = await createAssessmentAction(slug, {
        frameworkId,
        scopeId: String(formData.get('scopeId') ?? ''),
        campaignLabel: String(formData.get('campaignLabel') ?? ''),
        nis2Entity: nis2Entity === null ? undefined : String(nis2Entity),
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
          value={activeCampaign?.id ?? assessments[0]?.id}
          onChange={(e) => selectCampaign(e.target.value)}
        >
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
        <button className="btn btn-ghost btn-sm" onClick={() => { setError(null); setOpen(true); }}>
          {ongoing ? 'Nouvelle campagne' : 'Lancer une évaluation'}
        </button>
      ) : null}

      {canManage && activeCampaign?.status === 'en_cours' ? (
        <button className="btn btn-ghost btn-sm" onClick={() => { setError(null); setConfirmClose(true); }} disabled={pending}>
          Clôturer la campagne
        </button>
      ) : null}

      {canManage && activeCampaign ? (
        <>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setError(null); setConfirmExport(true); }}
            disabled={pending || nothingAssessed}
          >
            {pending ? 'Demande…' : 'Exporter la Déclaration d’applicabilité'}
          </button>
          {nothingAssessed ? (
            <span className="campaign-hint">Évaluez au moins une exigence avant d’exporter.</span>
          ) : null}
        </>
      ) : null}

      {activeCampaign && score ? (
        <div className="campaign-metrics">
          <div className="metric">
            <span className="metric-value">{score.scorePct === null ? '—' : `${score.scorePct}%`}</span>
            <span className="metric-label">conformité</span>
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

      {error && !open && !confirmExport && !confirmClose ? (
        <p className="form-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>
          {error}
        </p>
      ) : null}

      {activeCampaign && exportsList.length > 0 ? (
        <div className="campaign-exports">
          {exportsList.map((e) => (
            <ExportRow
              key={e.id}
              slug={slug}
              canManage={canManage}
              exp={e}
              pending={pending}
              onRefresh={() => router.refresh()}
              onRetry={requestExport}
            />
          ))}
        </div>
      ) : null}

      {open ? (
        <Dialog title={ongoing ? 'Nouvelle campagne' : 'Lancer une évaluation'} onClose={() => setOpen(false)}>
          <form onSubmit={keepValues(create)}>
            {ongoing ? (
              <p>
                <b>La campagne « {ongoing.campaignLabel} » est en cours ; en ouvrir une autre ?</b> Pour
                poursuivre l’évaluation, fermez cette fenêtre : les statuts déjà saisis restent dans la
                campagne « {ongoing.campaignLabel} ». Une nouvelle campagne repart de zéro (nouveau cycle,
                autre périmètre).
              </p>
            ) : null}
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
            {frameworkCode === 'recyf' ? (
              <fieldset className="nis2-picker">
                <legend>Catégorie NIS 2 de l’organisation</legend>
                <label className="nis2-option">
                  <input type="radio" name="nis2Entity" value="ei" defaultChecked={nis2Default === 'ei'} required />
                  Entité importante
                </label>
                <label className="nis2-option">
                  <input type="radio" name="nis2Entity" value="ee" defaultChecked={nis2Default === 'ee'} />
                  Entité essentielle
                </label>
                <p className="nis2-picker-help">
                  {nis2Default
                    ? 'Pré-rempli d’après la qualification NIS 2 de vos entités (Obligations). '
                    : 'Qualification NIS 2 non renseignée : choisissez la catégorie qui s’applique. '}
                  Pour une entité importante, les mesures réservées aux entités essentielles entrent
                  « Non applicable », avec une justification que vous pourrez reprendre.
                </p>
              </fieldset>
            ) : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                {pending ? 'Création…' : ongoing ? 'Ouvrir une autre campagne' : 'Lancer'}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {confirmExport && activeCampaign ? (
        <Dialog title="Exporter la Déclaration d’applicabilité ?" onClose={() => setConfirmExport(false)}>
          <p>
            {toAssess > 0
              ? `${toAssess} exigence${toAssess > 1 ? 's sont' : ' est'} encore à évaluer et apparaîtr${toAssess > 1 ? 'ont' : 'a'} ainsi dans le PDF. `
              : null}
            Le document scellé ne pourra plus être modifié : son empreinte est publiée sur une page de
            vérification.
          </p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmExport(false)}>
              Annuler
            </button>
            <button className="btn btn-primary btn-sm" onClick={requestExport} disabled={pending}>
              {pending ? 'Demande…' : 'Sceller et exporter'}
            </button>
          </div>
        </Dialog>
      ) : null}

      {confirmClose && activeCampaign ? (
        <Dialog title={`Clôturer « ${activeCampaign.campaignLabel} » ?`} onClose={() => setConfirmClose(false)}>
          <p>
            Les statuts de cette campagne seront figés : plus aucune exigence ne pourra y être modifiée. Les
            exports déjà produits restent disponibles ; pour réévaluer, ouvrez une nouvelle campagne.
          </p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClose(false)}>
              Annuler
            </button>
            <button className="btn btn-primary btn-sm" onClick={closeCampaign} disabled={pending}>
              {pending ? 'Clôture…' : 'Clôturer la campagne'}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
