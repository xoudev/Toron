'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { safeInternalPath } from '@/lib/safe-path';

export default function InscriptionPage() {
  return (
    <Suspense fallback={null}>
      <InscriptionForm />
    </Suspense>
  );
}

function InscriptionForm() {
  const suite = safeInternalPath(useSearchParams().get('suite'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function creerCompte(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (password.length < 12) {
      setErreur('Mot de passe trop court — 12 caractères minimum.');
      return;
    }
    setEnCours(true);
    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: suite,
    });
    if (error) {
      setEnCours(false);
      setErreur(
        error.code?.startsWith('USER_ALREADY_EXISTS')
          ? 'Un compte existe déjà avec cette adresse — connectez-vous plutôt.'
          : 'Création impossible — vérifiez les champs saisis puis réessayez.',
      );
      return;
    }
    // La session est ouverte : on poursuit vers la destination demandée.
    window.location.assign(suite);
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
      <h1>Créer un compte Toron</h1>
      <form onSubmit={creerCompte}>
        <label>
          Nom complet
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </label>
        <label>
          Adresse e-mail professionnelle
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Mot de passe (12 caractères minimum)
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        {erreur ? <p role="alert">{erreur}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={enCours}>
          {enCours ? 'Création…' : 'Créer le compte'}
        </button>
      </form>
      <p className="auth-alt">
        Déjà un compte ?{' '}
        <a href={suite === '/organisations' ? '/connexion' : `/connexion?suite=${encodeURIComponent(suite)}`}>Se connecter</a>
      </p>
      </div>
    </main>
  );
}
