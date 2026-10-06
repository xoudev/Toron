'use server';

import { appError, canConfigureOrganisation } from '@toron/core';
import { createExport, withTenant, writeAuditEntry } from '@toron/db';
import { revalidatePath } from 'next/cache';

import { authorizeRole, isActionError, logFailure, type ActionResult } from '@/lib/action-guard';
import { appDb } from '@/lib/db';

/**
 * Demande la version scellée du rapport de direction : le worker Typst la
 * calcule à la date du jour, la compile et la scelle (poinçon SHA-256 + page
 * /verifier). L'objet de référence est l'organisation.
 */
export async function requestBoardExportAction(slug: string): Promise<ActionResult<{ exportId: string }>> {
  const auth = await authorizeRole(
    slug,
    canConfigureOrganisation,
    'Seuls la direction, le RSSI et le responsable qualité scellent le rapport de direction.',
  );
  if (isActionError(auth)) return { ok: false, error: auth };
  try {
    const exportId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createExport(tx, { tenantId: auth.tenantId, type: 'rapport', objectRef: auth.tenantId, requestedBy: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'export.request', objectType: 'export', objectId: id, after: { type: 'rapport' }, ip: auth.ip, userAgent: auth.userAgent });
      return id;
    });
    revalidatePath(`/t/${slug}/rapport`);
    return { ok: true, data: { exportId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_EXPORT', 'La demande de rapport scellé a échoué — réessayez.')) };
  }
}
