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
    const { data, error } = await authClient.signIn
      .email({
        email,
        password,
        callbackURL: suite,
      })
      // Réseau indisponible : message générique, sans laisser le bouton bloqué.
      .catch(() => ({ data: null, error: { status: 0, code: undefined } }));
    if (error) {
      setEnCours(false);
      // Une limite de débit ou une panne n'est pas une erreur de saisie :
      // réessayer aussitôt prolongerait le blocage. FAILED_TO_CREATE_SESSION
      // arrive pourtant en 401.
      setErreur(
        error.status === 429
          ? 'Trop de tentatives — patientez une minute puis réessayez.'
          : error.code?.startsWith('FAILED_TO_')
            ? 'Connexion impossible pour le moment — réessayez dans quelques instants.'
            : error.status === 400 || error.status === 401
              ? 'Identifiants incorrects — vérifiez l’adresse e-mail et le mot de passe, puis réessayez.'
              : 'Connexion impossible pour le moment — réessayez dans quelques instants.',
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
