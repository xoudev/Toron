'use client';

import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'toron-theme';

/**
 * Bascule clair/sombre : attribut data-theme sur <html>, préférence
 * mémorisée localement. Le sombre est le défaut produit.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, [theme]);

  return (
    <button
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Basculer en thème clair' : 'Basculer en thème sombre'}
    >
      {theme === 'dark' ? (
        <HugeiconsIcon icon={Sun03Icon} size={20} strokeWidth={2} aria-hidden="true" />
      ) : (
        <HugeiconsIcon icon={Moon02Icon} size={20} strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}
