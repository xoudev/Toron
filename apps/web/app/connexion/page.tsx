'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { safeInternalPath } from '@/lib/safe-path';

export default function ConnexionPage() {
  return (
    <Suspense fallback={null}>
      <ConnexionForm />
    </Suspense>
  );
}

function ConnexionForm() {
  const suite = safeInternalPath(useSearchParams().get('suite'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function seConnecter(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    const { data, error } = await authClient.signIn.email({
      email,
      password,
      callbackURL: suite,
    });
    if (error) {
      setEnCours(false);
      setErreur(
        'Identifiants incorrects — vérifiez l’adresse e-mail et le mot de passe, puis réessayez.',
      );
      return;
    }
    // Un compte protégé par TOTP passe par la vérification du second facteur,
    // qui reprend la destination validée ; sinon on y va directement.
    if (data && 'twoFactorRedirect' in data) {
      window.location.assign(`/connexion/2fa?suite=${encodeURIComponent(suite)}`);
      return;
    }
    window.location.assign(suite);
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
      <h1>Connexion à Toron</h1>
      <form onSubmit={seConnecter}>
        <label>
          Adresse e-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {erreur ? <p role="alert">{erreur}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={enCours}>
          {enCours ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="auth-alt">
        Pas encore de compte ?{' '}
        <a href={suite === '/organisations' ? '/inscription' : `/inscription?suite=${encodeURIComponent(suite)}`}>Créer un compte</a>
      </p>
      </div>
    </main>
  );
}
