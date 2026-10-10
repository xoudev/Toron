'use client';

import {
  ASSESSMENT_ITEM_STATUSES,
  exclusionAllowed,
  soaJustificationRequired,
  type AssessmentItemStatus,
  type StatusSuggestion,
} from '@toron/core';
import type { AssessmentItemRow, RequirementNode } from '@toron/db';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createActionFromGapAction,
  getInheritedSuggestionsAction,
  setItemStatusAction,
} from './assessment-actions';

const STATUS_LABEL: Record<AssessmentItemStatus, string> = {
  conforme: 'Conforme',
  ecart: 'Écart',
  non_applicable: 'Non applicable',
  a_evaluer: 'À évaluer',
};
const FRAMEWORK_BADGE: Record<string, string> = {
  recyf: 'NIS 2',
  iso27001: 'ISO 27001',
  iso9001: 'ISO 9001',
  rgpd: 'RGPD',
};

export function EvaluationPanel({
  slug,
  canManage,
  frameworkId,
  frameworkCode,
  assessmentId,
  requirement,
  item,
}: {
  slug: string;
  canManage: boolean;
  frameworkId: string;
  frameworkCode: string;
  assessmentId: string;
  requirement: RequirementNode;
  item: AssessmentItemRow | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AssessmentItemStatus>(item?.status ?? 'a_evaluer');
  const [justification, setJustification] = useState(item?.soaJustification ?? '');
  const [statement, setStatement] = useState(item?.statement ?? '');
  const [suggestions, setSuggestions] = useState<StatusSuggestion[] | null>(null);
  const [gapAction, setGapAction] = useState<{ actionId: string; existing: boolean } | null>(null);

  const naNeedsJustif = soaJustificationRequired(status);
  // ISO 27001 : les clauses 4 à 10 ne s'excluent pas (core.exclusionAllowed).
  const canExclude = exclusionAllowed(frameworkCode, requirement.ref);
  const statuses = ASSESSMENT_ITEM_STATUSES.filter((s) => canExclude || s !== 'non_applicable');

  function createCorrectiveAction() {
    setError(null);
    start(async () => {
      const res = await createActionFromGapAction(slug, {
        assessmentId,
        requirementId: requirement.id,
        requirementRef: requirement.ref,
        requirementTitle: requirement.title,
      });
      if (res.ok) setGapAction(res.data);
      else setError(res.error.message);
    });
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await setItemStatusAction(slug, {
        frameworkId,
        assessmentId,
        requirementId: requirement.id,
        status,
        statement: statement.trim() || null,
        soaJustification: justification.trim() || null,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      // Après un statut conforme, proposer l'héritage sur les pairs mutualisés.
      if (status === 'conforme') {
        const sug = await getInheritedSuggestionsAction(slug, {
          requirementId: requirement.id,
          sourceRef: requirement.ref,
          sourceStatus: 'conforme',
        });
        setSuggestions(sug.ok ? sug.data : []);
      } else {
        setSuggestions(null);
      }
      router.refresh();
    });
  }

  if (!canManage) {
    return (
      <div className="panel-section">
        <div className="panel-section-label">Évaluation</div>
        <span className={`status-pill status-pill--${item?.status ?? 'a_evaluer'}`}>
          {STATUS_LABEL[item?.status ?? 'a_evaluer']}
        </span>
      </div>
    );
  }

  return (
    <div className="panel-section">
      <div className="panel-section-label">Évaluation — statut de conformité</div>
      <div className="status-choices" role="group" aria-label="Statut de l’exigence">
        {statuses.map((s) => (
          <button
            key={s}
            className="status-choice"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {canExclude ? null : (
        <p style={{ margin: '-4px 0 10px', fontSize: 11.5, color: 'var(--text-3)' }}>
          Les clauses 4 à 10 ne peuvent pas être exclues ; seules les mesures de l’Annexe A le peuvent.
        </p>
      )}

      <label className="field">
        Constat (facultatif)
        <textarea
          rows={2}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="Mesure en place, preuve associée…"
        />
      </label>

      {naNeedsJustif ? (
        <label className="field">
          Justification d’exclusion (obligatoire)
          <textarea
            rows={2}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Pourquoi cette exigence est-elle non applicable à ce périmètre ?"
            required
          />
        </label>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button
        className="btn btn-primary btn-sm"
        disabled={pending || (naNeedsJustif && justification.trim().length === 0)}
        onClick={save}
      >
        {pending ? 'Enregistrement…' : 'Enregistrer le statut'}
      </button>

      {/* Seul un écart enregistré se convertit en action, une seule par écart. */}
      {item?.status === 'ecart' ? (
        <div style={{ marginTop: 10 }}>
          {gapAction ? (
            <p style={{ fontSize: 12, color: gapAction.existing ? 'var(--text-2)' : 'var(--ok)' }}>
              {gapAction.existing ? 'Action déjà ouverte pour cet écart — ' : 'Action corrective créée — '}
              <a href={`/t/${slug}/plan-action?ouvrir=${gapAction.actionId}`}>voir dans le plan d’action</a>.
            </p>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={pending} onClick={createCorrectiveAction}>
              Créer une action corrective
            </button>
          )}
        </div>
      ) : null}

      {suggestions && suggestions.length > 0 ? (
        <div className="inherit-suggestion" style={{ marginTop: 12 }}>
          <b>Prouvez une fois, couvrez tout.</b> Les contrôles rattachés couvrent aussi&nbsp;:
          {suggestions.map((s) => (
            <a className="inherit-peer" key={s.requirementId} href={`/t/${slug}/referentiels/${s.frameworkId}`}>
              <span className="mut-tag">
                <span className="mut-tag-dot" aria-hidden="true" />
                {FRAMEWORK_BADGE[s.frameworkCode] ?? s.frameworkCode.toUpperCase()}
              </span>
              <span className="chip-ref">{s.requirementRef}</span>
              <span style={{ color: 'var(--text-2)' }}>
                {s.hasCampaign ? `— peut hériter « conforme ». ${s.reason}` : '— aucune campagne en cours sur ce référentiel.'}
              </span>
            </a>
          ))}
          <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
            Ouvrez le référentiel concerné pour valider ces statuts dans sa campagne (traçabilité conservée).
          </p>
        </div>
      ) : null}
    </div>
  );
}
