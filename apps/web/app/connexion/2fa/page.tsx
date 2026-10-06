'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { safeInternalPath } from '@/lib/safe-path';

export default function Verification2faPage() {
  return (
    <Suspense fallback={null}>
      <Verification2fa />
    </Suspense>
  );
}

function Verification2fa() {
  const suite = safeInternalPath(useSearchParams().get('suite'));
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
    window.location.assign(suite);
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
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
        <button className="btn btn-primary" type="submit">Vérifier</button>
      </form>
      </div>
    </main>
  );
}
