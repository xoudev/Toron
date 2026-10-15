'use client';

import { Search01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

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
      <HugeiconsIcon icon={Search01Icon} size={20} strokeWidth={1.8} aria-hidden="true" />
      <span className="search-trigger-label">Rechercher…</span>
      <kbd>Ctrl K</kbd>
    </button>
  );
}
