import { schema } from '@toron/db';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { authDb } from '@/lib/db';

import { CreateTenantForm } from './create-tenant-form';

export const dynamic = 'force-dynamic';

export default async function OrganisationsPage() {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect('/connexion');

  const db = authDb().db;
  const rows = await db
    .select({
      slug: schema.tenants.slug,
      name: schema.tenants.name,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(eq(schema.memberships.userId, session.user.id));

  return (
    <main className="auth-page">
      <div className="auth-card">
      <h1>Vos organisations</h1>
      {rows.length === 0 ? (
        <p>Vous n’appartenez à aucune organisation pour l’instant — créez la vôtre.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.slug}>
              <a href={`/t/${r.slug}`}>{r.name}</a> — rôle : {r.role}
            </li>
          ))}
        </ul>
      )}
      <CreateTenantForm />
      </div>
    </main>
  );
}
