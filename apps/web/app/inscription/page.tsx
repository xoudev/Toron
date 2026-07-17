'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

export default function InscriptionPage() {
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
      callbackURL: '/organisations',
    });
    setEnCours(false);
    if (error) {
      setErreur(
        error.message === 'User already exists'
          ? 'Un compte existe déjà avec cette adresse — connectez-vous plutôt.'
          : 'Création impossible — vérifiez les champs saisis puis réessayez.',
      );
    }
  }

  return (
    <main>
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
        <button type="submit" disabled={enCours}>
          {enCours ? 'Création…' : 'Créer le compte'}
        </button>
      </form>
      <p>
        Déjà un compte ? <a href="/connexion">Se connecter</a>
      </p>
    </main>
  );
}
