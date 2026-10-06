'use client';

import { useEffect } from 'react';

/**
 * Impression du rapport (« Enregistrer au format PDF » depuis la boîte
 * d'impression). Le papier s'imprime toujours en thème clair : le thème est
 * basculé le temps de l'impression, y compris avec Ctrl+P, puis rétabli.
 */
export function PrintButton() {
  useEffect(() => {
    const root = document.documentElement;
    let previous: string | null = null;
    const before = () => {
      previous = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'light');
    };
    const after = () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  return (
    <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
      Imprimer ou enregistrer en PDF
    </button>
  );
}
