'use server';

import { appError } from '@toron/core';
import { countUnreadNotifications, listMyNotifications, markNotificationsRead, withTenant, type NotificationRow } from '@toron/db';
import { z } from 'zod';

import { authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';

// Chaque membre ne lit et ne marque que ses propres notifications : le
// destinataire vient toujours de la session, jamais de la saisie.
const authorizeMember = (slug: string) => authorizeRole(slug, () => true, 'Accès refusé.');

export async function listMyNotificationsAction(slug: string): Promise<ActionResult<NotificationRow[]>> {
  const auth = await authorizeMember(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  try {
    const rows = await withTenant(appDb().db, auth.tenantId, (tx) => listMyNotifications(tx, auth.userId));
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'Les notifications n’ont pas pu être chargées — réessayez.')) };
  }
}

export async function markNotificationsReadAction(slug: string, ids?: unknown): Promise<ActionResult<{ unread: number }>> {
  const auth = await authorizeMember(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.array(z.uuid()).max(100).optional().safeParse(ids);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const unread = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      await markNotificationsRead(tx, auth.userId, parsed.data);
      return countUnreadNotifications(tx, auth.userId);
    });
    return { ok: true, data: { unread } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'Le marquage comme lu a échoué — réessayez.')) };
  }
}
