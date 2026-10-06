import { MEMBERSHIP_ROLE_LABEL, type MembershipRole } from '@toron/core';
import { listPendingInvitationsForEmail, schema } from '@toron/db';
import { BrandMark, ThemeToggle } from '@toron/ui';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { SignOutButton } from '@/components/sign-out-button';
import { auth } from '@/lib/auth';
import { authDb } from '@/lib/db';

import { AcceptInvitationForm } from './accept-invitation-form';
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
    .where(eq(schema.memberships.userId, session.user.id))
    .orderBy(schema.tenants.name);
  const invitations = await listPendingInvitationsForEmail(db, session.user.email);

  // Un seul espace et aucune invitation : l'utilisateur y entre directement.
  if (rows.length === 1 && invitations.length === 0) redirect(`/t/${rows[0]!.slug}`);

  return (
    <main className="auth-page org-page">
      <div className="org-card">
        <header className="org-head">
          <span className="org-brand">
            <BrandMark size={22} />
            <b>toron</b>
          </span>
          <div className="org-head-actions">
            <ThemeToggle />
            <SignOutButton className="btn btn-ghost btn-sm" />
          </div>
        </header>

        <h1>Vos organisations</h1>
        <p className="org-help">
          Connecté en tant que <b>{session.user.name || session.user.email}</b>. Chaque
          organisation est un espace isolé : ses membres, périmètres et données ne se mélangent
          jamais avec ceux d’une autre.
        </p>

        {invitations.length > 0 ? (
          <section className="org-section" aria-labelledby="org-invitations">
            <h2 id="org-invitations">Invitations en attente</h2>
            <ul className="org-list">
              {invitations.map((inv) => (
                <li key={inv.id} className="org-item">
                  <div>
                    <b>{inv.tenantName}</b>
                    <small>
                      Rôle proposé : {MEMBERSHIP_ROLE_LABEL[inv.role]} · valable jusqu’au{' '}
                      {inv.expiresAt.toLocaleDateString('fr-FR')}
                    </small>
                  </div>
                  <AcceptInvitationForm invitationId={inv.id} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="org-section" aria-labelledby="org-membre">
          <h2 id="org-membre">Vos espaces</h2>
          {rows.length === 0 ? (
            <p className="org-empty">
              Vous n’appartenez encore à aucune organisation. Créez la vôtre ci-dessous, ou
              demandez à un responsable de vous inviter : son invitation apparaîtra ici.
            </p>
          ) : (
            <ul className="org-list">
              {rows.map((r) => (
                <li key={r.slug} className="org-item">
                  <div>
                    <b>{r.name}</b>
                    <small>{MEMBERSHIP_ROLE_LABEL[r.role as MembershipRole] ?? r.role}</small>
                  </div>
                  <a className="btn btn-primary btn-sm" href={`/t/${r.slug}`}>Ouvrir</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <CreateTenantForm open={rows.length === 0} />
      </div>
    </main>
  );
}
