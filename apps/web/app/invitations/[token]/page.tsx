import { acceptInvitation } from '@toron/db';
import { BrandMark } from '@toron/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { SignOutButton } from '@/components/sign-out-button';
import { auth } from '@/lib/auth';
import { authDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

/**
 * Lien d'invitation. Sans session, l'utilisateur se connecte ou crée son
 * compte puis revient ici ; avec session, l'appartenance est créée si
 * l'adresse correspond, et l'organisation s'ouvre.
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const suite = `/invitations/${encodeURIComponent(token)}`;
  const session = await auth().api.getSession({ headers: await headers() });

  if (!session) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
          <h1>Vous êtes invité à rejoindre une organisation</h1>
          <p>
            Connectez-vous avec l’adresse e-mail qui a reçu l’invitation, ou créez votre compte
            avec cette adresse. Vous reviendrez ensuite automatiquement ici.
          </p>
          <a className="btn btn-primary" href={`/connexion?suite=${encodeURIComponent(suite)}`}>Se connecter</a>
          <p className="auth-alt">
            Pas encore de compte ? <a href={`/inscription?suite=${encodeURIComponent(suite)}`}>Créer un compte</a>
          </p>
        </div>
      </main>
    );
  }

  const result = TOKEN_RE.test(token)
    ? await acceptInvitation(authDb().db, { token, userId: session.user.id, sessionEmail: session.user.email })
    : { ok: false as const, reason: 'Lien d’invitation incomplet — ouvrez le lien tel qu’il vous a été transmis.' };

  if (result.ok) redirect(`/t/${result.tenantSlug}`);

  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
        <h1>Invitation inutilisable</h1>
        <p role="alert">{result.reason}</p>
        <p className="auth-alt">
          Vous êtes connecté en tant que <b>{session.user.email}</b>.
        </p>
        <SignOutButton
          className="btn btn-primary"
          label="Changer de compte"
          redirectTo={`/connexion?suite=${encodeURIComponent(suite)}`}
        />
        <p className="auth-alt">
          <a href="/organisations">Voir vos organisations</a>
        </p>
      </div>
    </main>
  );
}
