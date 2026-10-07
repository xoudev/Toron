'use server';

import { createHash } from 'node:crypto';

import { appError, canManageControls, hardenDocumentHtml, nextSemver } from '@toron/core';
import {
  acknowledgeDocument,
  addVersion,
  createDocument,
  getAcknowledgementStatus,
  setAcknowledgementRequired,
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
  authorizeRole,
  isActionError,
  logFailure,
  type ActionResult,
} from '@/lib/action-guard';
import { antivirusGate } from '@/lib/antivirus';
import { appDb } from '@/lib/db';

export type { ActionResult };

// Lire un document publié est ouvert à tout membre ; les brouillons restent
// réservés aux rôles qui gèrent la documentation.
const authorizeReader = (slug: string) => authorizeRole(slug, () => true, 'Accès refusé.');

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
    const scan = await antivirusGate(auth, { name: file.name, content, sha256: createHash('sha256').update(content).digest('hex') });
    if (!scan.ok) return { ok: false, error: scan.error };
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
        after: { documentId, semver, fileName: file.name, antivirus: scan.antivirus },
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
    .object({ documentId: z.uuid(), semver: Semver, body: z.string().trim().min(1, 'Le contenu est vide.').max(400000) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', parsed.error.issues[0]?.message ?? 'Saisie invalide.') };
  const d = parsed.data;
  // Durcissement anti-XSS avant stockage (le contenu est du HTML riche).
  const body = hardenDocumentHtml(d.body);
  try {
    await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const versionId = await addVersion(tx, { tenantId: auth.tenantId, documentId: d.documentId, semver: d.semver, fileName: 'document.html', body, createdBy: auth.userId });
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
  const auth = await authorizeReader(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ versionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const body = await withTenant(appDb().db, auth.tenantId, (tx) => getVersionBody(tx, parsed.data.versionId, { publishedOnly: !canManageControls(auth.role) }));
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
  const auth = await authorizeReader(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = SuggestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const { versions, next } = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const list = await listVersions(tx, parsed.data.documentId, { publishedOnly: !canManageControls(auth.role) });
      const latest = await latestSemver(tx, parsed.data.documentId);
      return { versions: list, next: nextSemver(latest) };
    });
    return { ok: true, data: { versions, nextSemver: next } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'La lecture des versions a échoué — réessayez.')) };
  }
}

// ── Accusés de lecture ──────────────────────────────────────────────────

export interface AcknowledgementView {
  required: boolean;
  semver: string | null;
  acknowledgedByMe: Date | null;
  acknowledged: number;
  total: number;
  /** Détail par membre : réservé aux gestionnaires de la documentation. */
  members: { name: string; acknowledgedAt: Date | null }[] | null;
}

export async function getAcknowledgementsAction(slug: string, input: unknown): Promise<ActionResult<AcknowledgementView>> {
  const auth = await authorizeReader(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ documentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const status = await withTenant(appDb().db, auth.tenantId, (tx) => getAcknowledgementStatus(tx, parsed.data.documentId));
    if (!status) return { ok: false, error: appError('INTROUVABLE', 'Ce document n’existe plus — rechargez la page.') };
    const mine = status.members.find((m) => m.userId === auth.userId);
    return {
      ok: true,
      data: {
        required: status.required,
        semver: status.version?.semver ?? null,
        acknowledgedByMe: mine?.acknowledgedAt ?? null,
        acknowledged: status.version ? status.members.filter((m) => m.acknowledgedAt).length : 0,
        total: status.members.length,
        members: canManageControls(auth.role) ? status.members.map((m) => ({ name: m.name, acknowledgedAt: m.acknowledgedAt })) : null,
      },
    };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_LECTURE', 'Le suivi des lectures n’a pas pu être chargé — réessayez.')) };
  }
}

export async function setAcknowledgementRequiredAction(slug: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeManager(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ documentId: z.uuid(), required: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Demande invalide — rechargez la page.') };
  try {
    const n = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const affected = await setAcknowledgementRequired(tx, parsed.data.documentId, parsed.data.required);
      if (affected > 0) {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'document.acknowledgement_required', objectType: 'document',
          objectId: parsed.data.documentId, after: { required: parsed.data.required }, ip: auth.ip, userAgent: auth.userAgent,
        });
      }
      return affected;
    });
    if (n === 0) return { ok: false, error: appError('INTROUVABLE', 'Ce document n’existe plus — rechargez la page.') };
    revalidatePath(`/t/${slug}`, 'layout');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_MISE_A_JOUR', 'Le changement n’a pas été enregistré — réessayez.')) };
  }
}

/** L'accusé est toujours enregistré au nom de la session, jamais d'un tiers. */
export async function acknowledgeDocumentAction(slug: string, input: unknown): Promise<ActionResult<{ semver: string }>> {
  const auth = await authorizeReader(slug);
  if (isActionError(auth)) return { ok: false, error: auth };
  const parsed = z.object({ documentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: appError('SAISIE_INVALIDE', 'Référence invalide.') };
  try {
    const result = await withTenant(appDb().db, auth.tenantId, async (tx) => {
      const r = await acknowledgeDocument(tx, { tenantId: auth.tenantId, documentId: parsed.data.documentId, userId: auth.userId });
      if (r.outcome === 'accepte') {
        await writeAuditEntry(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'document.acknowledge', objectType: 'document_version',
          objectId: r.versionId, after: { semver: r.semver }, ip: auth.ip, userAgent: auth.userAgent,
        });
      }
      return r;
    });
    if (result.outcome === 'aucune_version') {
      return { ok: false, error: appError('AUCUNE_VERSION', 'Aucune version publiée à accepter pour l’instant.') };
    }
    revalidatePath(`/t/${slug}`, 'layout');
    return { ok: true, data: { semver: result.semver } };
  } catch (err) {
    return { ok: false, error: logFailure(err, appError('ECHEC_ACCUSE', 'L’acceptation n’a pas été enregistrée — réessayez.')) };
  }
}
