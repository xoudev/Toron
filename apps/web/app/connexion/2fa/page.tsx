'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

export default function Verification2faPage() {
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  async function verifier(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setErreur('Code invalide ou expiré — saisissez le code à 6 chiffres affiché à l’instant.');
      return;
    }
    window.location.href = '/organisations';
  }

  return (
    <main>
      <h1>Double authentification</h1>
      <p>Saisissez le code à 6 chiffres de votre application d’authentification.</p>
      <form onSubmit={verifier}>
        <label>
          Code TOTP
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            required
          />
        </label>
        {erreur ? <p role="alert">{erreur}</p> : null}
        <button type="submit">Vérifier</button>
      </form>
    </main>
  );
}
