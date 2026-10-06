'use client';

import { SEARCH_OPEN_EVENT } from '@toron/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { SearchResult } from '@/app/t/[slug]/recherche/route';

const DEBOUNCE_MS = 180;

/**
 * Palette de recherche transverse : Ctrl+K (ou ⌘K) depuis n'importe quel
 * écran de l'organisation. Navigation au clavier (↑ ↓ Entrée, Échap), modèle
 * combobox + listbox pour les lecteurs d'écran.
 */
export function SearchPalette({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    previousFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        previousFocus.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }
    }
    function onOpen() {
      previousFocus.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener(SEARCH_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SEARCH_OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      setState('idle');
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setState('loading');
      try {
        const res = await fetch(`/t/${encodeURIComponent(slug)}/recherche?q=${encodeURIComponent(text)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: SearchResult[] };
        setResults(body.results);
        setActive(0);
        setState('idle');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setState('error');
      }
    }, DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [q, open, slug]);

  if (!open) return null;

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      window.location.assign(results[active]!.href);
    }
  }

  const text = q.trim();
  return (
    <div className="dialog-backdrop search-backdrop" onMouseDown={close}>
      <div className="search-palette" role="dialog" aria-modal="true" aria-label="Recherche" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            maxLength={80}
            placeholder="Risque, action, exigence (A.5.19), code (ACT-098)…"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
          />
          <kbd>Échap</kbd>
        </div>
        <ul id={listId} role="listbox" className="search-results" aria-label="Résultats">
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.href}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <a href={r.href} onMouseEnter={() => setActive(i)}>
                <span className="ds-chip">{r.label}</span>
                <span className="search-hit">
                  <b>{r.title}</b>
                  {r.detail ? <small>{r.detail}</small> : null}
                </span>
                {r.code ? <span className="ds-id">{r.code}</span> : null}
              </a>
            </li>
          ))}
        </ul>
        <p className="search-status" role="status">
          {state === 'error'
            ? 'La recherche n’a pas abouti — vérifiez votre connexion puis réessayez.'
            : text.length < 2
              ? 'Saisissez au moins deux caractères. Un code comme RSK-482 ouvre directement la fiche.'
              : state === 'loading'
                ? 'Recherche…'
                : results.length === 0
                  ? `Aucun résultat pour « ${text} ».`
                  : `${results.length} résultat${results.length > 1 ? 's' : ''} · ↑ ↓ pour choisir, Entrée pour ouvrir`}
        </p>
      </div>
    </div>
  );
}
