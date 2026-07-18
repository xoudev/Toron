'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

// Tiroir latéral droit accessible (maquettes docs/design : le détail s'ouvre
// en aside, jamais en modale plein écran). role dialog + aria-modal, titre
// associé, fermeture Échap et clic sur le voile, piège de focus, restitution
// du focus au déclencheur (a11y, §8.3).

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Drawer({
  header,
  onClose,
  children,
  labelId,
}: {
  /** Contenu de l'en-tête collant (identifiant, badges…). */
  header: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** id d'un élément titre dans `header` (pour aria-labelledby). */
  labelId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fallbackId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const first = box?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="drawer-scrim" onMouseDown={onClose}>
      <aside
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId ?? fallbackId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          {header}
          <button className="drawer-close" onClick={onClose} aria-label="Fermer le panneau">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M6 6 18 18M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
