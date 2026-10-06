'use client';

import { useEffect, useState } from 'react';

const ATTR = 'data-nav-open';

/**
 * Ouverture de la navigation sur écran étroit : l'état vit sur <html> pour
 * que la sidebar (composant serveur) réagisse en CSS pur. Un changement de
 * page recharge le document et referme le volet.
 */
export function NavToggle() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) document.documentElement.setAttribute(ATTR, 'true');
    else document.documentElement.removeAttribute(ATTR);
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="icon-btn nav-toggle"
        aria-label={open ? 'Fermer la navigation' : 'Ouvrir la navigation'}
        aria-expanded={open}
        aria-controls="navigation-principale"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6 18 18M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open ? <button type="button" className="nav-scrim" aria-label="Fermer la navigation" onClick={() => setOpen(false)} /> : null}
    </>
  );
}
