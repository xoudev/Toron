'use server';

import { appError, validateRows, type ColumnMapping, type ImportTarget } from '@toron/core';
import {
  bulkCreateAssets,
  createAction,
  createRisk,
  listScopes,
  withTenant,
  writeAuditEntry,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  authorizeManager,
  isActionError,
  logFailure,
  type ActionResult,
} from '@/lib/action-guard';
import { appDb } from '@/lib/db';

export type { ActionResult };

const Target = z.enum(['risk', 'action', 'asset']);
const MappingSchema = z.array(
  z.object({ field: z.string(), label: z.string(), columnIndex: z.number().int().nullable(), confidence: z.number() }),
);
const ApplySchema = z.object({
  target: Target,
  rows: z.array(z.array(z.string())).max(5000),
  mapping: MappingSchema,
});

function asInt(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isInteger(v) ? v : dflt;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Applique un import : RE-VALIDE côté serveur (cœur, jamais de confiance au
 * client), insère les lignes valides selon la cible, journalise. Renvoie le
 * nombre importé et les lignes rejetées (cause + correction) — RM §5.13.
 */
export async function applyImportAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ imported: number; rejected: { line: number; cause: string; suggestion: string }[] }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = ApplySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Import invalide — rechargez la page et réessayez.') };
  }
  const target = parsed.data.target as ImportTarget;
  const mapping = parsed.data.mapping as ColumnMapping[];
  const { rows, rejected } = validateRows(parsed.data.rows, target, mapping);

  try {
    const imported = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      let n = 0;
      if (target === 'risk') {
        const scopes = await listScopes(tx);
        const scopeId = scopes[0]?.id;
        if (!scopeId) throw new Error('Aucun périmètre défini — créez un périmètre avant d’importer des risques.');
        for (const r of rows) {
          await createRisk(tx, {
            tenantId: auth.tenantId,
            scopeId,
            title: String(r.title),
            businessValue: asStr(r.businessValue),
            scenario: asStr(r.scenario),
            grossG: asInt(r.grossG, 1), grossV: asInt(r.grossV, 1), netG: asInt(r.netG, 1), netV: asInt(r.netV, 1),
            treatment: (asStr(r.treatment) as 'reduire' | 'transferer' | 'accepter' | 'eviter' | null) ?? 'reduire',
            ratedBy: auth.userId,
          });
          n += 1;
        }
      } else if (target === 'action') {
        for (const r of rows) {
          await createAction(tx, {
            tenantId: auth.tenantId,
            title: String(r.title),
            description: asStr(r.description),
            originType: 'manual',
            priority: (asStr(r.priority) as 'p1' | 'p2' | 'p3' | null) ?? 'p2',
            dueDate: asStr(r.dueDate),
          });
          n += 1;
        }
      } else {
        n = await bulkCreateAssets(
          tx,
          auth.tenantId,
          rows.map((r) => ({
            name: String(r.name),
            category: r.category as 'materiel' | 'logiciel' | 'donnees' | 'flux',
            description: asStr(r.description),
            dicp: { d: asInt(r.dicpD, 1), i: asInt(r.dicpI, 1), c: asInt(r.dicpC, 1), p: asInt(r.dicpP, 1) },
          })),
        );
      }
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'import.apply',
        objectType: target,
        after: { imported: n, rejected: rejected.length },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return n;
    });
    revalidatePath(`/t/${slug}/import`);
    return { ok: true, data: { imported, rejected: rejected.map((r) => ({ line: r.line, cause: r.cause, suggestion: r.suggestion })) } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_IMPORT', 'L’import a échoué — vérifiez le fichier et réessayez.')) };
  }
}
