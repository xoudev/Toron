'use server';

import { createHash } from 'node:crypto';

import { appError, effectiveValidUntil, evidenceFileError } from '@toron/core';
import {
  createEvidence,
  linkEvidence,
  listEvidenceHistory,
  renewEvidence,
  listAccessLog,
  listEvidenceLinks,
  unlinkEvidence,
  withTenant,
  writeAuditEntry,
  type AccessLogRow,
  type EvidenceHistoryRow,
  type EvidenceLinkRow,
} from '@toron/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  authorizeManager,
  authorizeRole,
  isActionError,
  logFailure,
  type ActionResult,
} from '@/lib/action-guard';
import { antivirusGate } from '@/lib/antivirus';
import { appDb } from '@/lib/db';

export type { ActionResult };

const EvType = z.enum(['capture', 'export', 'attestation', 'rapport', 'pv']);
const Recurrence = z.enum(['ponctuelle', 'trimestrielle', 'semestrielle', 'annuelle']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DateReq = z.string().regex(DATE_RE, 'Date attendue au format AAAA-MM-JJ');
const DateOpt = z.string().regex(DATE_RE, 'Date attendue au format AAAA-MM-JJ').optional().nullable();

/** Contrôles communs à tout fichier de preuve : présence, taille, extension. */
function checkUpload(file: FormDataEntryValue | null): { ok: true; file: File } | { ok: false; error: ReturnType<typeof appError> } {
  if (!(file instanceof File)) {
    return { ok: false, error: appError('FICHIER_MANQUANT', 'Choisissez un fichier à téléverser.') };
  }
  const invalid = evidenceFileError(file);
  if (invalid) return { ok: false, error: appError(invalid.code, invalid.message) };
  return { ok: true, file };
}

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
  const upload = checkUpload(formData.get('file'));
  if (!upload.ok) return { ok: false, error: upload.error };
  const file = upload.file;

  const d = parsed.data;
  try {
    const content = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(content).digest('hex');
    const scan = await antivirusGate(auth, { name: file.name, content, sha256 });
    if (!scan.ok) return { ok: false, error: scan.error };
    const evidenceId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createEvidence(tx, {
        tenantId: auth.tenantId,
        title: d.title,
        type: d.type,
        fileName: file.name,
        content,
        sha256,
        collectedAt: d.collectedAt,
        // Une preuve récurrente sans échéance saisie prend celle de sa récurrence.
        validUntil: effectiveValidUntil(d.collectedAt, d.recurrence, d.validUntil ?? null),
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
        after: { title: d.title, sha256, antivirus: scan.antivirus },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidatePath(`/t/${slug}/preuves`);
    return { ok: true, data: { evidenceId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_INGESTION', 'Le dépôt de la preuve a échoué — réessayez.')) };
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

// Consulter une preuve (rattachements, historique, accès) est ouvert à tout
// membre : l'auditeur en a besoin pour constater.
export async function getEvidenceDetailAction(
  slug: string,
  evidenceId: string,
): Promise<ActionResult<{ links: EvidenceLinkRow[]; access: AccessLogRow[]; history: EvidenceHistoryRow[] }>> {
  const auth = await authorizeRole(slug, () => true, 'Accès refusé.');
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.uuid().safeParse(evidenceId);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const data = await withTenant(appDb().db, auth.tenantId, async (tx) => ({
      links: await listEvidenceLinks(tx, parsed.data),
      access: await listAccessLog(tx, parsed.data),
      history: await listEvidenceHistory(tx, parsed.data),
    }));
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture a échoué — réessayez.')) };
  }
}

/**
 * Renouvelle une preuve : nouveau fichier (empreinte calculée côté serveur),
 * nouvelle validité ; rattachements hérités, ancienne preuve conservée comme
 * historique. RM §5.7.
 */
export async function renewEvidenceAction(slug: string, formData: FormData): Promise<ActionResult<{ evidenceId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ previousId: z.uuid(), collectedAt: DateReq, validUntil: DateOpt })
    .refine((d) => !d.validUntil || d.validUntil >= d.collectedAt, { message: 'La validité doit suivre la date de collecte.' })
    .safeParse({
      previousId: String(formData.get('previousId') ?? ''),
      collectedAt: String(formData.get('collectedAt') ?? ''),
      validUntil: String(formData.get('validUntil') ?? '') || null,
    });
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', parsed.error.issues[0]?.message ?? 'Renouvellement invalide — vérifiez les dates.') };
  }
  const upload = checkUpload(formData.get('file'));
  if (!upload.ok) return { ok: false, error: upload.error };
  const d = parsed.data;
  try {
    const content = Buffer.from(await upload.file.arrayBuffer());
    const sha256 = createHash('sha256').update(content).digest('hex');
    const scan = await antivirusGate(auth, { name: upload.file.name, content, sha256 });
    if (!scan.ok) return { ok: false, error: scan.error };
    const result = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const r = await renewEvidence(tx, {
        tenantId: auth.tenantId, previousId: d.previousId, fileName: upload.file.name, content, sha256,
        collectedAt: d.collectedAt, validUntil: d.validUntil ?? null, collectorUserId: auth.userId,
      });
      if (r.outcome === 'renouvelee') {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'evidence.renew', objectType: 'evidence',
          objectId: r.evidenceId, before: { evidenceId: d.previousId }, after: { sha256, validUntil: r.validUntil, antivirus: scan.antivirus },
          ip: auth.ip, userAgent: auth.userAgent,
        });
      }
      return r;
    });
    if (result.outcome === 'introuvable') return { ok: false, error: appError('INTROUVABLE', 'Cette preuve n’existe plus — rechargez la page.') };
    if (result.outcome === 'deja_remplacee') return { ok: false, error: appError('DEJA_REMPLACEE', 'Cette preuve a déjà été renouvelée — ouvrez la version en vigueur.') };
    revalidatePath(`/t/${slug}`, 'layout');
    return { ok: true, data: { evidenceId: result.evidenceId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_RENOUVELLEMENT', 'Le renouvellement a échoué — réessayez.')) };
  }
}
