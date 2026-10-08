'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

const PARAM = 'ouvrir';

/**
 * Élément ouvert dans un registre (panneau de détail), synchronisé avec
 * `?ouvrir=<id>` : un lien depuis « Mon travail » ou le tableau de bord ouvre
 * directement la fiche, et la fiche ouverte se partage par son URL.
 * Seul un identifiant présent dans la liste affichée est accepté : le
 * paramètre ne donne accès à rien que la page n'ait déjà chargé.
 */
export function useOpenItem(ids: readonly string[]): [string | null, (id: string | null) => void] {
  const requested = useSearchParams().get(PARAM);
  const [openId, setOpenIdState] = useState<string | null>(
    requested && ids.includes(requested) ? requested : null,
  );
  // Lien suivi depuis la page déjà ouverte (notification, recherche) : le
  // paramètre change sans remonter le composant, la fiche demandée s'ouvre.
  const [seen, setSeen] = useState(requested);
  if (requested !== seen) {
    setSeen(requested);
    if (requested && ids.includes(requested)) setOpenIdState(requested);
  }

  const setOpenId = useCallback((id: string | null) => {
    setOpenIdState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(PARAM, id);
    else url.searchParams.delete(PARAM);
    // État nul : Next.js intercepte l'appel et synchronise son routeur avec la
    // nouvelle URL (un rafraîchissement ultérieur la conserve).
    window.history.replaceState(null, '', url);
  }, []);

  return [openId, setOpenId];
}
