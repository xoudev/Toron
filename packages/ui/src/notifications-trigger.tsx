'use client';

import { Notification03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
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
      <HugeiconsIcon icon={Notification03Icon} size={20} strokeWidth={1.8} aria-hidden="true" />
      {state.unread > 0 ? <span className="notif-badge" aria-hidden="true">{state.unread > 99 ? '99+' : state.unread}</span> : null}
    </button>
  );
}
