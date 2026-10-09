'use client';

import { templateCoveragePreview, type TemplateCoverageFramework, type TemplateMappingLike } from '@toron/core';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { adoptControlTemplatesAction } from './control-actions';

export interface TemplateOption {
  key: string;
  domain: string;
  title: string;
  mappings: TemplateMappingLike[];
}

export interface TemplateDomainOption {
  key: string;
  label: string;
}

export interface TemplateAdoptionResult {
  created: number;
  mappings: number;
}

interface PanelProps {
  slug: string;
  templates: TemplateOption[];
  domains: TemplateDomainOption[];
  adoptedKeys: string[];
  coverage: TemplateCoverageFramework[];
  /** Reprise faite : le registre affiche le résultat et ouvre la vue « À adapter ». */
  onAdopted: (r: TemplateAdoptionResult) => void;
}

/**
 * Reprise des contrôles types : choix des domaines, aperçu de la couverture
 * gagnée sur chaque référentiel activé, puis création en brouillon.
 */
function TemplatesPanel({ slug, templates, domains, adoptedKeys, coverage, onAdopted }: PanelProps) {
  const router = useRouter();
  const adopted = useMemo(() => new Set(adoptedKeys), [adoptedKeys]);
  const remaining = templates.filter((t) => !adopted.has(t.key));
  const domainsLeft = domains.filter((d) => remaining.some((t) => t.domain === d.key));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(domainsLeft.map((d) => d.key)));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const selected = remaining.filter((t) => chosen.has(t.domain));
  const preview = templateCoveragePreview(coverage, selected);

  function toggle(key: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function adopt() {
    setError(null);
    start(async () => {
      const r = await adoptControlTemplatesAction(slug, { domains: [...chosen] });
      if (r.ok) {
        onAdopted(r.data);
        router.refresh();
      } else setError(r.error.message);
    });
  }

  if (remaining.length === 0) {
    return <p className="ds-muted">Tous les contrôles types ont déjà été repris par votre organisation.</p>;
  }

  return (
    <div className="tpl-panel">
      <p className="tpl-intro">
        {remaining.length} contrôles rédigés pour une PME ou une ETI, chacun déjà rattaché aux exigences qu’il couvre dans
        ISO 27001, NIS 2 (ReCyF), le RGPD et les autres référentiels intégrés. Ils sont créés en brouillon : vous les adaptez, puis
        vous les activez.
      </p>

      <fieldset className="tpl-domains">
        <legend>
          Domaines à reprendre
          <span>
            <button type="button" className="link-btn" onClick={() => setChosen(new Set(domainsLeft.map((d) => d.key)))}>Tout</button>
            {' · '}
            <button type="button" className="link-btn" onClick={() => setChosen(new Set())}>Aucun</button>
          </span>
        </legend>
        {domainsLeft.map((d) => {
          const n = remaining.filter((t) => t.domain === d.key).length;
          return (
            <label key={d.key} className="tpl-domain">
              <input type="checkbox" checked={chosen.has(d.key)} onChange={() => toggle(d.key)} />
              <span>{d.label}</span>
              <small>{n}</small>
            </label>
          );
        })}
      </fieldset>

      <div className="tpl-preview" aria-live="polite">
        <p className="panel-section-label">Exigences outillées après reprise</p>
        {preview.length === 0 ? (
          <p className="tpl-warning">
            Aucun référentiel intégré n’est encore activé : les contrôles seront créés sans rattachement, puis rattachés
            automatiquement dès que vous activerez ISO 27001, NIS 2 ou un autre référentiel intégré.
          </p>
        ) : preview.map((p) => (
          <div key={p.code} className="tpl-fw">
            <span className="tpl-fw-name">{p.name}</span>
            <span className="tpl-fw-track" aria-hidden="true">
              <span className="tpl-fw-before" style={{ width: `${(p.before / Math.max(p.leafCount, 1)) * 100}%` }} />
              <span className="tpl-fw-after" style={{ width: `${((p.after - p.before) / Math.max(p.leafCount, 1)) * 100}%` }} />
            </span>
            <span className="tpl-fw-count ds-mono">{p.before === p.after ? p.after : `${p.before} → ${p.after}`} / {p.leafCount}</span>
          </div>
        ))}
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={adopt} disabled={pending || selected.length === 0}>
          {pending ? 'Création…' : `Reprendre ${selected.length} contrôle${selected.length > 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}

/** Première visite : la reprise des contrôles types tient lieu d'état vide. */
export function ControlTemplatesStart(props: PanelProps & { canManage: boolean }) {
  return (
    <section className="card tpl-start">
      <h2>Partir des contrôles types Toron</h2>
      {props.canManage ? <TemplatesPanel {...props} /> : (
        <p className="ds-muted">Aucun contrôle interne pour l’instant. Un responsable peut reprendre les contrôles types ou les créer depuis un référentiel.</p>
      )}
      <p className="tpl-alt">
        Vous préférez partir de zéro ? <a href={`/t/${props.slug}/referentiels`}>Créez vos contrôles depuis un référentiel</a>, exigence par exigence.
      </p>
    </section>
  );
}

/** Contrôles déjà en place : la reprise reste accessible pour les domaines non repris. */
export function ControlTemplatesButton(props: PanelProps) {
  const [open, setOpen] = useState(false);
  const left = props.templates.filter((t) => !props.adoptedKeys.includes(t.key)).length;
  if (left === 0) return null;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Contrôles types · {left}</button>
      {open ? (
        <Drawer header={<span className="ds-chip" id="tpl-title">Contrôles types</span>} labelId="tpl-title" onClose={() => setOpen(false)}>
          <div className="drawer-wide">
            <h2 className="sup-title">Partir des contrôles types Toron</h2>
            <TemplatesPanel {...props} onAdopted={(r) => { setOpen(false); props.onAdopted(r); }} />
          </div>
        </Drawer>
      ) : null}
    </>
  );
}

/** Résultat d'une reprise, affiché au-dessus du registre. */
export function TemplateAdoptionNotice({ result, onClose }: { result: TemplateAdoptionResult; onClose: () => void }) {
  return (
    <div className="tpl-done" role="status">
      <p>
        <b>{result.created} contrôle{result.created > 1 ? 's' : ''} créé{result.created > 1 ? 's' : ''} en brouillon</b>, avec{' '}
        {result.mappings} rattachement{result.mappings > 1 ? 's' : ''} aux exigences de vos référentiels. Ouvrez-les un à un :
        ajustez la description à votre réalité, désignez un responsable, puis passez-les en « Actif ». Ceux qui ne vous
        concernent pas s’archivent.
      </p>
      <button type="button" className="link-btn" onClick={onClose}>Masquer</button>
    </div>
  );
}
