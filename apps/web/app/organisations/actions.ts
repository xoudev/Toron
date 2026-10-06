'use server';

import { SCOPE_KINDS, slugifyTenantName } from '@toron/core';
import { acceptInvitation, createTenantWithOwner } from '@toron/db';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { authDb } from '@/lib/db';

const CreateTenantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nom d’organisation trop court — 2 caractères minimum.')
    .max(120, 'Nom d’organisation trop long — 120 caractères maximum.'),
  scopeName: z.string().trim().min(2, 'Nommez votre premier périmètre (2 caractères minimum).').max(120),
  scopeKind: z.enum(SCOPE_KINDS, { error: 'Choisissez la nature du périmètre.' }),
});

export interface CreateTenantState {
  erreur: string | null;
}

/**
 * Création d'une organisation par l'utilisateur connecté, qui en devient
 * propriétaire. Le slug est dérivé du nom (RM §5.1 : contexte explicite
 * dans l'URL) et dédoublonné si nécessaire.
 */
export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect('/connexion');

  const parsed = CreateTenantSchema.safeParse({
    name: formData.get('name'), scopeName: formData.get('scopeName'), scopeKind: formData.get('scopeKind'),
  });
  if (!parsed.success) {
    return { erreur: parsed.error.issues[0]?.message ?? 'Saisie invalide.' };
  }

  const base = slugifyTenantName(parsed.data.name);
  if (!base) {
    return {
      erreur: 'Nom d’organisation invalide — utilisez au moins une lettre ou un chiffre.',
    };
  }

  let slug: string;
  try {
    const tenant = await createTenantWithOwner(authDb().db, {
      ...parsed.data, baseSlug: base, userId: session.user.id,
    });
    slug = tenant.slug;
  } catch {
    const correlationId = crypto.randomUUID();
    console.error('[toron] création d’organisation impossible', { correlationId });
    return { erreur: `Création impossible — réessayez ou choisissez un nom plus distinctif. Référence : ${correlationId}.` };
  }
  // redirect lève un signal Next ; il doit rester hors du catch métier.
  redirect(`/t/${slug}`);
}

export interface AcceptInvitationState {
  erreur: string | null;
}

/** Rejoint une organisation depuis la liste des invitations en attente. */
export async function acceptInvitationAction(
  _prev: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect('/connexion');
  const invitationId = z.uuid().safeParse(formData.get('invitationId'));
  if (!invitationId.success) return { erreur: 'Invitation invalide — rechargez la page.' };

  let slug: string;
  try {
    const result = await acceptInvitation(authDb().db, {
      invitationId: invitationId.data, userId: session.user.id, sessionEmail: session.user.email,
    });
    if (!result.ok) return { erreur: result.reason };
    slug = result.tenantSlug;
  } catch {
    const correlationId = crypto.randomUUID();
    console.error('[toron] acceptation d’invitation impossible', { correlationId });
    return { erreur: `Impossible de rejoindre l’organisation — réessayez. Référence : ${correlationId}.` };
  }
  redirect(`/t/${slug}`);
}
