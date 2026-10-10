import { ThemeToggle, Topbar } from '@toron/ui';
import type { Metadata } from 'next';

import { DashboardLink } from './dashboard-link';

export const metadata: Metadata = { title: 'Page introuvable — Toron' };

/** Page absente dans une organisation (lien périmé, élément supprimé, adresse mal saisie). */
export default function TenantNotFound() {
  return (
    <>
      <Topbar crumbRoot="Erreur" crumbCurrent="Page introuvable" actions={<ThemeToggle />} />
      <main className="app-page">
        <div className="empty-state">
          <h2>Page introuvable</h2>
          <p>
            Cette adresse ne correspond à aucune page de l’organisation : le lien est peut-être périmé, ou l’élément
            a été supprimé. Repartez du tableau de bord ou retrouvez l’élément avec la recherche (Ctrl+K).
          </p>
          <DashboardLink className="btn btn-primary btn-sm">Retour au tableau de bord</DashboardLink>
        </div>
      </main>
    </>
  );
}
