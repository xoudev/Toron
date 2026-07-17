'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

export default function ConnexionPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function seConnecter(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    const { error } = await authClient.signIn.email({
      email,
      password,
      callbackURL: '/organisations',
    });
    setEnCours(false);
    if (error) {
      setErreur(
        'Identifiants incorrects — vérifiez l’adresse e-mail et le mot de passe, puis réessayez.',
      );
    }
  }

  return (
    <main>
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
        <button type="submit" disabled={enCours}>
          {enCours ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p>
        Pas encore de compte ? <a href="/inscription">Créer un compte</a>
      </p>
    </main>
  );
}
