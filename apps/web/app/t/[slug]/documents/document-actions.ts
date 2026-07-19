'use server';

import { appError, nextSemver } from '@toron/core';
import {
  addVersion,
  createDocument,
  getVersionBody,
  latestSemver,
  listVersions,
  publishVersion,
  setDocumentProcess,
  withTenant,
  writeAuditEntry,
  type DocumentVersionRow,
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

const DocType = z.enum(['pssi', 'politique', 'procedure', 'charte', 'pca_pra', 'fiche_processus', 'autre']);
const Semver = z.string().trim().regex(/^\d+(\.\d+){0,2}$/, 'Version attendue au format « 1.0 ».');
const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
  .optional()
  .nullable();

// Allowlist de types de fichiers (extensions) + taille max (S8/§8).
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'odt', 'txt', 'md', 'ppt', 'pptx', 'xls', 'xlsx'];

const CreateSchema = z.object({
  type: DocType,
  title: z.string().trim().min(2, '2 caractères minimum').max(200),
  scopeId: z.uuid().optional().nullable(),
  processId: z.uuid().optional().nullable(),
  ownerUserId: z.uuid().optional().nullable(),
  reviewDue: DateStr,
});

export async function createDocumentAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ documentId: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Document invalide — un type et un intitulé (2 caractères min) sont requis.') };
  }
  const d = parsed.data;
  try {
    const documentId = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const id = await createDocument(tx, {
        tenantId: auth.tenantId,
        type: d.type,
        title: d.title,
        scopeId: d.scopeId ?? null,
        processId: d.processId ?? null,
        ownerUserId: d.ownerUserId ?? null,
        reviewDue: d.reviewDue ?? null,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'document.create',
        objectType: 'document',
        objectId: id,
        after: { type: d.type, title: d.title },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
      return id;
    });
    revalidatePath(`/t/${slug}/documents`);
    return { ok: true, data: { documentId } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_CREATION', 'La création du document a échoué — réessayez.')) };
  }
}

/**
 * Ajoute une version (brouillon) avec téléversement de fichier. Reçoit un
 * FormData : documentId, semver, file. Allowlist de types + taille max.
 */
export async function addVersionAction(slug: string, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };

  const documentId = String(formData.get('documentId') ?? '');
  const semver = String(formData.get('semver') ?? '');
  const file = formData.get('file');

  if (!z.uuid().safeParse(documentId).success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de document invalide.') };
  }
  if (!Semver.safeParse(semver).success) {
    return { ok: false, error: appError('SAISIE_INVALIDE', 'Numéro de version invalide — attendu « 1.0 ».') };
  }
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

  try {
    const content = Buffer.from(await file.arrayBuffer());
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const versionId = await addVersion(tx, {
        tenantId: auth.tenantId,
        documentId,
        semver,
        fileName: file.name,
        content,
        createdBy: auth.userId,
      });
      await writeAuditEntry(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'document.version_add',
        objectType: 'document_version',
        objectId: versionId,
        after: { documentId, semver, fileName: file.name },
        ip: auth.ip,
        userAgent: auth.userAgent,
      });
    });
    revalidatePath(`/t/${slug}/documents`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_VERSION', 'L’ajout de la version a échoué — le numéro existe peut-être déjà.')) };
  }
}

/**
 * Rédige une version DANS Toron (éditeur intégré) : crée un brouillon dont le
 * contenu est du texte, sans téléversement de fichier.
 */
export async function writeVersionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z
    .object({ documentId: z.uuid(), semver: Semver, body: z.string().trim().min(1, 'Le contenu est vide.').max(200000) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', parsed.error.issues[0]?.message ?? 'Saisie invalide.') };
  const d = parsed.data;
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const versionId = await addVersion(tx, { tenantId: auth.tenantId, documentId: d.documentId, semver: d.semver, fileName: 'document.md', body: d.body, createdBy: auth.userId });
      await writeAuditEntry(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'document.version_write', objectType: 'document_version', objectId: versionId, after: { documentId: d.documentId, semver: d.semver }, ip: auth.ip, userAgent: auth.userAgent });
    });
    revalidatePath(`/t/${slug}/documents`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_VERSION', 'L’enregistrement a échoué — le numéro de version existe peut-être déjà.')) };
  }
}

export async function setDocumentProcessAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ documentId: z.uuid(), processId: z.uuid().nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Rattachement invalide.') };
  try {
    await withTenant(appDb().db, auth.tenantId, (tx) => setDocumentProcess(tx, parsed.data.documentId, parsed.data.processId));
    revalidatePath(`/t/${slug}/documents`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_RATTACHEMENT', 'Le rattachement au processus a échoué.')) };
  }
}

export async function getVersionBodyAction(slug: string, input: unknown): Promise<ActionResult<{ body: string | null }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ versionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const body = await withTenant(appDb().db, auth.tenantId, (tx) => getVersionBody(tx, parsed.data.versionId));
    return { ok: true, data: { body } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture du contenu a échoué.')) };
  }
}

export async function publishVersionAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ versionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence de version invalide.') };
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await publishVersion(tx, parsed.data.versionId);
      if (affected > 0) {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'document.publish',
          objectType: 'document_version',
          objectId: parsed.data.versionId,
          ip: auth.ip,
          userAgent: auth.userAgent,
        });
      }
      return affected;
    });
    if (n === 0) {
      return { ok: false, error: appError('DEJA_PUBLIEE', 'Cette version est déjà publiée ou n’existe plus (une version publiée est immuable).') };
    }
    revalidatePath(`/t/${slug}/documents`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_PUBLICATION', 'La publication a échoué — réessayez.')) };
  }
}

const SuggestSchema = z.object({ documentId: z.uuid() });

/** Charge les versions d'un document + propose le prochain semver. */
export async function getVersionsAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ versions: DocumentVersionRow[]; nextSemver: string }>> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SuggestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const { versions, next } = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const list = await listVersions(tx, parsed.data.documentId);
      const latest = await latestSemver(tx, parsed.data.documentId);
      return { versions: list, next: nextSemver(latest) };
    });
    return { ok: true, data: { versions, nextSemver: next } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture des versions a échoué — réessayez.')) };
  }
}
