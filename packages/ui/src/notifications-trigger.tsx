'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

/** Événement écouté par le centre de notifications de l'application. */
export const NOTIFICATIONS_OPEN_EVENT = 'toron:notifications';

interface NotificationsState {
  unread: number;
  setUnread: (n: number) => void;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

/** Fournit le nombre de notifications non lues à la cloche de la barre supérieure. */
export function NotificationsProvider({ initialUnread, children }: { initialUnread: number; children: ReactNode }) {
  const [unread, setUnread] = useState(initialUnread);
  const [seen, setSeen] = useState(initialUnread);
  // Le layout recalcule le compte à chaque navigation : on s'aligne dessus.
  if (initialUnread !== seen) {
    setSeen(initialUnread);
    setUnread(initialUnread);
  }
  return <NotificationsContext.Provider value={{ unread, setUnread }}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsCount(): NotificationsState | null {
  return useContext(NotificationsContext);
}

/** Cloche de la barre supérieure ; absente hors d'une organisation. */
export function NotificationsTrigger() {
  const state = useNotificationsCount();
  if (!state) return null;
  const label = state.unread > 0 ? `Notifications — ${state.unread} non lue${state.unread > 1 ? 's' : ''}` : 'Notifications';
  return (
    <button
      type="button"
      className="notif-trigger"
      onClick={() => window.dispatchEvent(new CustomEvent(NOTIFICATIONS_OPEN_EVENT))}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </svg>
      {state.unread > 0 ? <span className="notif-badge" aria-hidden="true">{state.unread > 99 ? '99+' : state.unread}</span> : null}
    </button>
  );
}
