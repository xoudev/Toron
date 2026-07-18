'use server';

import { createHash } from 'node:crypto';

import { appError } from '@toron/core';
import {
  createEvidence,
  linkEvidence,
  listAccessLog,
  listEvidenceLinks,
  unlinkEvidence,
  withTenant,
  writeAuditEntry,
  type AccessLogRow,
  type EvidenceLinkRow,
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

const EvType = z.enum(['capture', 'export', 'attestation', 'rapport', 'pv']);
const Recurrence = z.enum(['ponctuelle', 'trimestrielle', 'semestrielle', 'annuelle']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DateReq = z.string().regex(DATE_RE, 'Date attendue au format AAAA-MM-JJ');
const DateOpt = z.string().regex(DATE_RE, 'Date attendue au format AAAA-MM-JJ').optional().nullable();

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'csv', 'txt', 'md', 'docx', 'xlsx', 'zip', 'json'];

/**
 * Ingestion d'une preuve : reçoit un FormData (fichier + métadonnées). Calcule
 * le SHA-256 côté serveur, applique l'allowlist et la taille max, lie
 * optionnellement un contrôle. RM §5.7.
 */
export async function createEvidenceAction(
  slug: string,
  formData: FormData,
): Promise<ActionResult<{ evidenceId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };

  const parsed = z
    .object({
      title: z.string().trim().min(2, '2 caractères minimum').max(200),
      type: EvType,
      collectedAt: DateReq,
      validUntil: DateOpt,
      recurrence: Recurrence,
      controlId: z.uuid().optional().nullable(),
    })
    .safeParse({
      title: String(formData.get('title') ?? ''),
      type: String(formData.get('type') ?? 'export'),
      collectedAt: String(formData.get('collectedAt') ?? ''),
      validUntil: String(formData.get('validUntil') ?? '') || null,
      recurrence: String(formData.get('recurrence') ?? 'ponctuelle'),
      controlId: String(formData.get('controlId') ?? '') || null,
    });
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Preuve invalide — intitulé, type, date de collecte et récurrence sont requis.') };
  }
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: appError('FICHIER_MANQUANT', 'Choisissez un fichier à téléverser.') };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: appError('FICHIER_TROP_GROS', 'Fichier trop volumineux — 10 Mo maximum.') };
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXT.includes(ext)) {
    return { ok: false, error: appError('TYPE_REFUSE', `Type de fichier non autorisé (.${ext}). Formats admis : ${ALLOWED_EXT.join(', ')}.`) };
  }

  const d = parsed.data;
  try {
    const content = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(content).digest('hex');
    const evidenceId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createEvidence(tx, {
        tenantId: auth.tenantId,
        title: d.title,
        type: d.type,
        fileName: file.name,
        content,
        sha256,
        collectedAt: d.collectedAt,
        validUntil: d.validUntil ?? null,
        recurrence: d.recurrence,
        collectorUserId: auth.userId,
        links: d.controlId ? [{ targetType: 'control', targetId: d.controlId }] : [],
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'evidence.create',
        objectType: 'evidence',
        objectId: id,
        after: { title: d.title, sha256 },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidatePath(`/t/${slug}/preuves`);
    return { ok: true, data: { evidenceId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_INGESTION', 'L’ingestion de la preuve a échoué — réessayez.')) };
  }
}

const LinkSchema = z.object({ evidenceId: z.uuid(), controlId: z.uuid(), linked: z.boolean() });

export async function toggleEvidenceControlAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      if (d.linked) {
        await linkEvidence(tx, { tenantId: auth.tenantId, evidenceId: d.evidenceId, targetType: 'control', targetId: d.controlId });
      } else {
        await unlinkEvidence(tx, { evidenceId: d.evidenceId, targetType: 'control', targetId: d.controlId });
      }
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: d.linked ? 'evidence.link' : 'evidence.unlink',
        objectType: 'evidence',
        objectId: d.evidenceId,
        after: { controlId: d.controlId },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/preuves`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LIAISON', 'La liaison a échoué — réessayez.')) };
  }
}

export async function getEvidenceDetailAction(
  slug: string,
  evidenceId: string,
): Promise<ActionResult<{ links: EvidenceLinkRow[]; access: AccessLogRow[] }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(evidenceId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const data = await withTenant(appDb().db, auth.tenantId, async (tx) => ({
      links: await listEvidenceLinks(tx, parsed.data),
      access: await listAccessLog(tx, parsed.data),
    }));
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué — réessayez.')) };
  }
}
