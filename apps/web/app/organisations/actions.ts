'use server';

import { slugifyTenantName } from '@toron/core';
import { schema } from '@toron/db';
import { eq } from 'drizzle-orm';
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
});

export interface CreateTenantState {
  erreur: string | null;
}

/**
 * Création d'une organisation (tenant) + membership owner pour
 * l'utilisateur connecté. Opération système exécutée sous toron_auth —
 * le rôle applicatif ne peut pas créer de tenant (politique RLS M0-2).
 */
export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect('/connexion');

  const parsed = CreateTenantSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return { erreur: parsed.error.issues[0]?.message ?? 'Saisie invalide.' };
  }

  const base = slugifyTenantName(parsed.data.name);
  if (base === '') {
    return {
      erreur:
        'Nom d’organisation invalide — utilisez au moins un caractère alphanumérique.',
    };
  }

  const db = authDb().db;
  let slug = base;
  for (let tentative = 0; ; tentative += 1) {
    const existing = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug));
    if (existing.length === 0) break;
    if (tentative >= 5) {
      return {
        erreur:
          'Ce nom d’organisation est déjà très utilisé — choisissez un intitulé plus distinctif.',
      };
    }
    slug = `${base}-${tentative + 2}`;
  }

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: parsed.data.name, slug })
    .returning({ id: schema.tenants.id, slug: schema.tenants.slug });
  await db.insert(schema.memberships).values({
    tenantId: tenant!.id,
    userId: session.user.id,
    role: 'owner',
  });

  redirect(`/t/${tenant!.slug}`);
}
