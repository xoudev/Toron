'use client';

import type { FreshnessState } from '@toron/core';
import type { AccessLogRow, EvidenceLinkRow, EvidenceSummary } from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  createEvidenceAction,
  getEvidenceDetailAction,
  toggleEvidenceControlAction,
} from './evidence-actions';

type ControlLite = { id: string; title: string };

const FRESH_LABEL: Record<FreshnessState, string> = {
  expiree: 'Expirée',
  bientot: 'Bientôt',
  fraiche: 'Fraîche',
  permanente: 'Permanente',
};
const TYPE_LABEL: Record<string, string> = {
  capture: 'Capture',
  export: 'Export',
  attestation: 'Attestation',
  rapport: 'Rapport',
  pv: 'PV',
};
const RECURRENCE_LABEL: Record<string, string> = {
  ponctuelle: 'Ponctuelle',
  trimestrielle: 'Trimestrielle',
  semestrielle: 'Semestrielle',
  annuelle: 'Annuelle',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function EvidenceVault({
  slug,
  canManage,
  evidences,
  controls,
}: {
  slug: string;
  canManage: boolean;
  evidences: EvidenceSummary[];
  controls: ControlLite[];
}) {
  const [creating, setCreating] = useState(false);
  const [openEv, setOpenEv] = useState<EvidenceSummary | null>(null);

  return (
    <>
      {canManage ? (
        <div className="plan-toolbar">
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouvelle preuve</button>
        </div>
      ) : null}

      {evidences.length === 0 ? (
        <div className="empty-state"><h2>Coffre vide</h2><p>Téléversez une preuve et rattachez-la à un contrôle.</p></div>
      ) : (
        <div className="card ev-table-card">
          <div className="ev-table-wrap">
            <table className="ev-table">
              <thead>
                <tr>
                  <th>Preuve</th>
                  <th>Fraîcheur</th>
                  <th>Collectée</th>
                  <th>Valide jusqu’au</th>
                  <th>Récurrence</th>
                  <th>Collecteur</th>
                  <th>Liens</th>
                  <th>Empreinte</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {evidences.map((e) => (
                  <tr key={e.id}>
                    <td className="ev-title-cell" onClick={() => setOpenEv(e)}>
                      {e.title}
                      <div className="ev-type">{TYPE_LABEL[e.type] ?? e.type}</div>
                    </td>
                    <td><span className={`fresh-tag fresh--${e.freshness}`}>{FRESH_LABEL[e.freshness]}</span></td>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(e.collectedAt)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(e.validUntil)}</td>
                    <td style={{ fontSize: 12 }}>{RECURRENCE_LABEL[e.recurrence] ?? e.recurrence}</td>
                    <td>{e.collectorName ?? '—'}</td>
                    <td className="mono">{e.linkCount}</td>
                    <td className="ev-hash" title={e.sha256}>{e.sha256.slice(0, 10)}…</td>
                    <td>{e.hasContent ? <a className="link-btn" href={`/t/${slug}/preuves/${e.id}`}>Télécharger</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating ? (
        <CreateDialog slug={slug} controls={controls} onClose={() => setCreating(false)} />
      ) : null}
      {openEv ? (
        <DetailDialog slug={slug} ev={openEv} controls={controls} canManage={canManage} onClose={() => setOpenEv(null)} />
      ) : null}
    </>
  );
}

function CreateDialog({
  slug,
  controls,
  onClose,
}: {
  slug: string;
  controls: ControlLite[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(fd: FormData) {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choisissez un fichier.');
      return;
    }
    fd.set('file', file);
    start(async () => {
      const res = await createEvidenceAction(slug, fd);
      if (res.ok) {
        onClose();
        router.refresh();
      } else setError(res.error.message);
    });
  }

  return (
    <Dialog title="Nouvelle preuve" onClose={onClose}>
      <form action={submit}>
        <label className="field">
          Intitulé
          <input name="title" minLength={2} required placeholder="PV de test de restauration…" />
        </label>
        <div className="risk-form-grid">
          <label className="field">
            Type
            <select name="type" defaultValue="export">
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            Récurrence de collecte
            <select name="recurrence" defaultValue="ponctuelle">
              {Object.entries(RECURRENCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            Date de collecte
            <input type="date" name="collectedAt" required />
          </label>
          <label className="field">
            Valide jusqu’au (fraîcheur)
            <input type="date" name="validUntil" />
          </label>
          <label className="field field--full">
            Contrôle couvert (mutualisation)
            <select name="controlId" defaultValue="">
              <option value="">— Aucun —</option>
              {controls.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        </div>
        <div className="upload-drop">
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.md,.docx,.xlsx,.zip,.json" required />
          <p className="risk-mut-hint" style={{ margin: 0 }}>Empreinte SHA-256 calculée à l’ingestion. 10 Mo max.</p>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            {pending ? 'Ingestion…' : 'Ajouter la preuve'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DetailDialog({
  slug,
  ev,
  controls,
  canManage,
  onClose,
}: {
  slug: string;
  ev: EvidenceSummary;
  controls: ControlLite[];
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [links, setLinks] = useState<EvidenceLinkRow[] | null>(null);
  const [access, setAccess] = useState<AccessLogRow[]>([]);
  const [pending, start] = useTransition();

  const reload = () =>
    getEvidenceDetailAction(slug, ev.id).then((res) => {
      if (res.ok) {
        setLinks(res.data.links);
        setAccess(res.data.access);
      }
    });

  useEffect(() => {
    let alive = true;
    getEvidenceDetailAction(slug, ev.id).then((res) => {
      if (alive && res.ok) {
        setLinks(res.data.links);
        setAccess(res.data.access);
      }
    });
    return () => {
      alive = false;
    };
  }, [slug, ev.id]);

  const linkedControlIds = new Set((links ?? []).filter((l) => l.targetType === 'control').map((l) => l.targetId));

  function toggle(controlId: string, next: boolean) {
    start(async () => {
      const res = await toggleEvidenceControlAction(slug, { evidenceId: ev.id, controlId, linked: next });
      if (res.ok) {
        await reload();
        router.refresh();
      }
    });
  }

  return (
    <Dialog title={ev.title} onClose={onClose}>
      <div className="doc-meta" style={{ marginBottom: 10 }}>
        <span className={`fresh-tag fresh--${ev.freshness}`}>{FRESH_LABEL[ev.freshness]}</span>
        <span className="ev-hash" title={ev.sha256}>SHA-256 {ev.sha256.slice(0, 16)}…</span>
        {ev.hasContent ? <a className="link-btn" href={`/t/${slug}/preuves/${ev.id}`}>Télécharger</a> : null}
      </div>

      <p className="rating-block-title">Contrôles couverts (mutualisation)</p>
      {links === null ? (
        <p className="risk-mut-hint">Chargement…</p>
      ) : controls.length === 0 ? (
        <p className="risk-mut-hint">Aucun contrôle interne à rattacher.</p>
      ) : (
        <div className="control-link-list">
          {controls.map((c) => (
            <label className="control-link-row" key={c.id}>
              <input
                type="checkbox"
                checked={linkedControlIds.has(c.id)}
                disabled={!canManage || pending}
                onChange={(e) => toggle(c.id, e.target.checked)}
              />
              {c.title}
            </label>
          ))}
        </div>
      )}

      <p className="rating-block-title" style={{ marginTop: 16 }}>Journal des accès</p>
      {access.length === 0 ? (
        <p className="risk-mut-hint">Aucun accès enregistré.</p>
      ) : (
        <div className="access-log">
          {access.map((a, i) => (
            <div className="access-row" key={i}>
              <span>{a.userName ?? 'Utilisateur'} — {a.kind}</span>
              <span className="mono">{new Date(a.at).toLocaleString('fr-FR')}</span>
            </div>
          ))}
        </div>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>
      </div>
    </Dialog>
  );
}
