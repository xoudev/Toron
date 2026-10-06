'use client';

import { MODULE_META, OPTIONAL_MODULES, normalizeDisabledModules, type OptionalModule } from '@toron/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { setModulesAction } from './actions';
import type { Viewer } from './parametres-client';

const FAMILIES: { key: 'risques' | 'management' | 'qualite'; label: string }[] = [
  { key: 'risques', label: 'Risques et sécurité' },
  { key: 'management', label: 'Système de management' },
  { key: 'qualite', label: 'Qualité (ISO 9001)' },
];

export function SectionModules({ slug, viewer, disabled }: { slug: string; viewer: Viewer; disabled: OptionalModule[] }) {
  const router = useRouter();
  const [off, setOff] = useState<OptionalModule[]>(disabled);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = off.join() !== disabled.join();

  function toggle(m: OptionalModule, enabled: boolean) {
    setSaved(false);
    const next = enabled ? off.filter((x) => x !== m) : [...off, m];
    // Réactiver EBIOS RM réactive le registre des risques dont il dépend.
    const req = MODULE_META[m].requires;
    const withDeps = enabled && req ? next.filter((x) => x !== req) : next;
    setOff(normalizeDisabledModules(withDeps));
  }
  function save() {
    setError(null);
    start(async () => {
      const res = await setModulesAction(slug, { disabled: off });
      if (res.ok) { setSaved(true); router.refresh(); } else setError(res.error.message);
    });
  }

  return (
    <article className="card settings-card">
      <div className="settings-card-head">
        <div>
          <h2>Modules de l’organisation</h2>
          <p className="hint">
            Le socle (référentiels, plan d’action, documents, preuves) est toujours présent. Activez les
            modules utiles à votre organisation : les autres disparaissent de la navigation, du tableau de
            bord, de « Mon travail » et de la recherche. Les données déjà saisies sont conservées.
          </p>
        </div>
      </div>
      {FAMILIES.map((f) => (
        <div key={f.key} className="module-family">
          <p className="drawer-section-label">{f.label}</p>
          <div className="module-list">
            {OPTIONAL_MODULES.filter((m) => MODULE_META[m].family === f.key).map((m) => {
              const enabled = !off.includes(m);
              const req = MODULE_META[m].requires;
              return (
                <label key={m} className={`module-row${enabled ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={enabled} disabled={!viewer.canConfigure || pending} onChange={(e) => toggle(m, e.target.checked)} />
                  <span>
                    <b>{MODULE_META[m].label}</b>
                    <small>{MODULE_META[m].description}{req ? ` Nécessite ${MODULE_META[req].label.toLowerCase()}.` : ''}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {viewer.canConfigure ? (
        <div className="settings-actions">
          {saved && !dirty ? <span className="status" role="status">Modules enregistrés.</span> : null}
          <button className="btn btn-primary btn-sm" disabled={!dirty || pending} onClick={save}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      ) : (
        <p className="hint">Lecture seule — la configuration est réservée au propriétaire, à la direction, au RSSI et au responsable qualité.</p>
      )}
    </article>
  );
}
