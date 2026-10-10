'use client';

import { ThemeToggle, Topbar } from '@toron/ui';
import { useParams } from 'next/navigation';

/**
 * Échec du chargement d'une page de l'organisation : le message reste en
 * français, la navigation reste disponible, et la référence (digest) permet
 * de retrouver l'erreur dans les journaux serveur sans rien en exposer.
 */
export default function TenantError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { slug } = useParams<{ slug: string }>();
  return (
    <>
      <Topbar crumbRoot="Erreur" crumbCurrent="Page indisponible" actions={<ThemeToggle />} />
      <main className="app-page">
        <div className="empty-state" role="alert">
          <h2>Cette page n’a pas pu se charger</h2>
          <p>
            Le serveur ou la connexion a rencontré un problème passager. Réessayez ;{' '}
            {error.digest
              ? 'si le problème persiste, transmettez la référence ci-dessous à votre administrateur.'
              : 'si le problème persiste, prévenez votre administrateur en indiquant la page concernée.'}
          </p>
          {error.digest ? <p className="ds-muted">Référence : <span className="mono">{error.digest}</span></p> : null}
          <div className="empty-state-actions">
            <a className="btn btn-ghost btn-sm" href={`/t/${slug}`}>Tableau de bord</a>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => retry()}>Réessayer</button>
          </div>
        </div>
      </main>
    </>
  );
}
