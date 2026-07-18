'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

// Modale accessible : role dialog + aria-modal, titre associé, fermeture
// par Échap et par clic sur le voile, piège de focus, et restitution du
// focus au déclencheur à la fermeture (a11y, §8.3).

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const box = ref.current;
    // Focus initial sur le premier élément focusable (ou la boîte).
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
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && activeEl === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
