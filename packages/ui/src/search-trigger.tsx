'use client';

/** Événement écouté par la palette de recherche de l'application. */
export const SEARCH_OPEN_EVENT = 'toron:recherche';

/** Bouton de la barre supérieure ouvrant la recherche (raccourci Ctrl+K). */
export function SearchTrigger() {
  return (
    <button
      type="button"
      className="search-trigger"
      onClick={() => window.dispatchEvent(new CustomEvent(SEARCH_OPEN_EVENT))}
      aria-label="Rechercher dans l’organisation (Ctrl+K)"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <span className="search-trigger-label">Rechercher…</span>
      <kbd>Ctrl K</kbd>
    </button>
  );
}
