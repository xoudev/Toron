import { BrandMark } from '@toron/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Page introuvable — Toron' };

/** Adresse inconnue, hors de toute organisation ou mal saisie. */
export default function NotFound() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
        <h1>Page introuvable</h1>
        <p>
          Cette adresse ne correspond à aucune page de Toron : le lien est peut-être périmé ou mal saisi.
          Repartez de la liste de vos organisations.
        </p>
        <a className="btn btn-primary" href="/organisations">Vos organisations</a>
      </div>
    </main>
  );
}
