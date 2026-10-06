'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { requestBoardExportAction } from './report-actions';

export interface SealedVersion {
  id: string;
  status: string;
  sha256: string | null;
  verifySlug: string | null;
  sealedAtLabel: string | null;
  requestedAtLabel: string;
}

/** Versions scellées du rapport : demande, suivi de la génération, téléchargement et vérification. */
export function SealedVersions({ slug, versions, canSeal }: { slug: string; versions: SealedVersion[]; canSeal: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const generating = versions.some((v) => v.status === 'en_cours' || v.status === 'en_traitement');

  // Le worker scelle en quelques secondes : on rafraîchit tant qu'une version est en cours.
  useEffect(() => {
    if (!generating) return;
    const t = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(t);
  }, [generating, router]);

  function request() {
    setError(null);
    start(async () => {
      const r = await requestBoardExportAction(slug);
      if (r.ok) router.refresh();
      else setError(r.error.message);
    });
  }

  return (
    <section className="board-section no-print" aria-labelledby="b-sealed">
      <div className="board-sealed-head">
        <h2 id="b-sealed">Versions scellées</h2>
        {canSeal ? <button type="button" className="btn btn-ghost btn-sm" onClick={request} disabled={pending || generating}>{generating ? 'Génération en cours…' : 'Générer la version scellée'}</button> : null}
      </div>
      <p className="board-sealed-hint">Un PDF horodaté dont l’empreinte SHA-256 se vérifie sur une page publique : la preuve de ce qui a été présenté à la direction.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {versions.length === 0 ? <p className="ds-muted">Aucune version scellée pour l’instant.</p> : (
        <ul className="board-list" aria-live="polite">
          {versions.map((v) => (
            <li key={v.id} className="board-sealed-row">
              {v.status === 'scelle' ? (
                <>
                  <span>Scellé le {v.sealedAtLabel}</span>
                  <a href={`/t/${slug}/exports/${v.id}/pdf`}>Télécharger le PDF</a>
                  {v.verifySlug ? <a href={`/verifier/${v.verifySlug}`} target="_blank" rel="noreferrer">Vérifier le poinçon ↗</a> : null}
                  {v.sha256 ? <span className="ds-mono" title={v.sha256}>{v.sha256.slice(0, 12)}…</span> : null}
                </>
              ) : v.status === 'echec' ? (
                <span className="board-sealed-failed">Échec de la génération demandée le {v.requestedAtLabel} — relancez la génération.</span>
              ) : (
                <span className="ds-muted">Génération demandée le {v.requestedAtLabel}…</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
