import { BrandMark } from '@toron/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { safeInternalPath } from '@/lib/safe-path';

import { Activation2fa } from './activation-2fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Activer la double authentification — Toron' };

/**
 * L'activation du TOTP exige une session ouverte : sinon, connexion puis retour
 * ici. `suite` (chemin interne validé) indique où reprendre une fois activé.
 */
export default async function Activation2faPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams)['suite'];
  const retour = safeInternalPath(typeof raw === 'string' ? raw : null);
  const ici = retour === '/organisations' ? '/securite/2fa' : `/securite/2fa?suite=${encodeURIComponent(retour)}`;
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect(`/connexion?suite=${encodeURIComponent(ici)}`);
  // Déjà activée (rechargement de l'étape finale, retour arrière) : relancer
  // l'activation serait refusé, on le dit plutôt que de redemander le mot de passe.
  if (session.user.twoFactorEnabled) {
    return (
      <main className="auth-page">
        <div className="auth-card totp-card">
          <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
          <h1>Double authentification</h1>
          <p role="status">La double authentification est déjà active sur votre compte.</p>
          <a className="btn btn-primary" href={retour}>{retour === '/organisations' ? 'Continuer vers vos organisations' : 'Continuer'}</a>
        </div>
      </main>
    );
  }
  return <Activation2fa suite={ici} retour={retour} />;
}
