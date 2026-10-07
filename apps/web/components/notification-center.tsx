'use client';

import type { NotificationRow } from '@toron/db';
import { Drawer, NOTIFICATIONS_OPEN_EVENT, useNotificationsCount } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { listMyNotificationsAction, markNotificationsReadAction } from '@/app/t/[slug]/notification-actions';

const SUBJECT_LABEL: Record<string, string> = {
  action: 'Action',
  risque: 'Risque',
  obligation: 'Obligation',
  fournisseur: 'Fournisseur',
  traitement: 'Traitement',
  derogation: 'Dérogation',
  controle: 'Contrôle',
};

const RELATIVE = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

function ago(d: Date): string {
  const minutes = Math.round((d.getTime() - Date.now()) / 60_000);
  if (minutes > -60) return RELATIVE.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return RELATIVE.format(hours, 'hour');
  return RELATIVE.format(Math.round(hours / 24), 'day');
}

/** Centre de notifications : ouvert depuis la cloche de la barre supérieure. */
export function NotificationCenter({ slug }: { slug: string }) {
  const router = useRouter();
  const count = useNotificationsCount();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    function onOpen() {
      setOpen(true);
      setError(null);
      listMyNotificationsAction(slug).then((r) => {
        if (r.ok) setItems(r.data);
        else setError(r.error.message);
      });
    }
    window.addEventListener(NOTIFICATIONS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(NOTIFICATIONS_OPEN_EVENT, onOpen);
  }, [slug]);

  function markAll() {
    start(async () => {
      const r = await markNotificationsReadAction(slug);
      if (r.ok) {
        count?.setUnread(r.data.unread);
        setItems((prev) => prev?.map((n) => (n.readAt ? n : { ...n, readAt: new Date() })) ?? prev);
      } else setError(r.error.message);
    });
  }

  function follow(n: NotificationRow) {
    start(async () => {
      if (!n.readAt) {
        const r = await markNotificationsReadAction(slug, [n.id]);
        if (r.ok) count?.setUnread(r.data.unread);
      }
      setOpen(false);
      router.push(n.href);
    });
  }

  if (!open) return null;
  const unread = items?.filter((n) => !n.readAt).length ?? 0;
  const header = <><span className="ds-id" id="notif-title">Notifications</span>{unread > 0 ? <span className="ds-chip">{unread} non lue{unread > 1 ? 's' : ''}</span> : null}</>;

  return (
    <Drawer header={header} labelId="notif-title" onClose={() => setOpen(false)}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {items === null && !error ? <p className="ds-muted">Chargement…</p> : null}
      {items && items.length === 0 ? (
        <div className="empty-state"><h2>Rien de nouveau</h2><p>Les actions, risques, obligations, fournisseurs et fiches de traitement qu’on vous confie apparaîtront ici.</p></div>
      ) : null}
      {items && items.length > 0 ? (
        <>
          <ul className="notif-list">
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'notif-unread'}>
                <button type="button" onClick={() => follow(n)} disabled={pending}>
                  <span className="notif-title">{n.title}</span>
                  <span className="notif-meta">{SUBJECT_LABEL[n.subject] ?? n.subject}{n.actorName ? ` · par ${n.actorName}` : ''} · {ago(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {unread > 0 ? <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={markAll} disabled={pending}>Tout marquer comme lu</button></div> : null}
        </>
      ) : null}
    </Drawer>
  );
}
