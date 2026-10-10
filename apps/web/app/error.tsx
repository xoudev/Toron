'use client';

import { BrandMark } from '@toron/ui';

/** Échec de chargement hors du contenu d'une organisation (y compris son cadre de navigation). */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="auth-page">
      <div className="auth-card" role="alert">
        <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
        <h1>Cette page n’a pas pu se charger</h1>
        <p>
          Le serveur ou la connexion a rencontré un problème passager. Réessayez ;{' '}
          {error.digest
            ? 'si le problème persiste, transmettez la référence ci-dessous à votre administrateur.'
            : 'si le problème persiste, prévenez votre administrateur en indiquant la page concernée.'}
        </p>
        {error.digest ? <p className="ds-muted">Référence : <span className="mono">{error.digest}</span></p> : null}
        <button type="button" className="btn btn-primary" onClick={() => retry()}>Réessayer</button>
        <div className="auth-actions">
          <a className="btn btn-ghost btn-sm" href="/organisations">Vos organisations</a>
        </div>
      </div>
    </main>
  );
}
