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

type Mode = 'totp' | 'secours';

interface Echec {
  message: string;
  /** Seule une nouvelle connexion par mot de passe débloque la situation. */
  reconnexion: boolean;
}

/** Message d'échec selon la cause renvoyée par better-auth. */
function echec(error: { code?: string; status: number }, mode: Mode): Echec {
  // Vérification expirée (10 minutes) ou annulée après 5 codes faux : le
  // défi n'existe plus, même le bon code échouerait.
  if (error.code === 'INVALID_TWO_FACTOR_COOKIE' || error.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') {
    return { message: 'Vérification expirée — reconnectez-vous avec votre mot de passe.', reconnexion: true };
  }
  if (error.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
    return {
      message: 'Trop d’échecs : la vérification est bloquée 15 minutes. Reconnectez-vous ensuite avec votre mot de passe.',
      reconnexion: false,
    };
  }
  // Limiteur de better-auth (10 s) ou du proxy (fenêtre fixe d'une minute).
  if (error.status === 429) {
    return { message: 'Trop de tentatives — patientez jusqu’à une minute puis réessayez.', reconnexion: false };
  }
  if (error.status === 401) {
    return {
      message: mode === 'secours'
        ? 'Code de secours invalide ou déjà utilisé — chaque code ne sert qu’une fois.'
        : 'Code invalide ou expiré — saisissez le code à 6 chiffres affiché à l’instant.',
      reconnexion: false,
    };
  }
  return { message: 'Vérification impossible pour le moment — réessayez dans quelques instants.', reconnexion: false };
}

function Verification2fa() {
  const suite = safeInternalPath(useSearchParams().get('suite'));
  const connexion = suite === '/organisations' ? '/connexion' : `/connexion?suite=${encodeURIComponent(suite)}`;
  const [mode, setMode] = useState<Mode>('totp');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<Echec | null>(null);
  const [enCours, setEnCours] = useState(false);
  const secours = mode === 'secours';

  async function verifier(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    let error: { code?: string; status: number } | null;
    try {
      ({ error } = secours
        ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
        : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') }));
    } catch {
      // Réseau indisponible : message générique, sans laisser le bouton bloqué.
      error = { status: 0 };
    }
    if (error) {
      setEnCours(false);
      setErreur(echec(error, mode));
      return;
    }
    window.location.assign(suite);
  }

  function changerDeMode() {
    setMode(secours ? 'totp' : 'secours');
    setCode('');
    setErreur(null);
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
      <h1>Double authentification</h1>
      <p>
        {secours
          ? 'Saisissez l’un des codes de secours enregistrés lors de l’activation. Chaque code ne sert qu’une fois.'
          : 'Saisissez le code à 6 chiffres de votre application d’authentification.'}
      </p>
      <form onSubmit={verifier}>
        <label key={mode}>
          {secours ? 'Code de secours' : 'Code à 6 chiffres'}
          <input
            inputMode={secours ? 'text' : 'numeric'}
            pattern={secours ? undefined : '[0-9 ]{6,7}'}
            maxLength={secours ? undefined : 7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete={secours ? 'off' : 'one-time-code'}
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
          />
        </label>
        {erreur ? (
          <p role="alert">
            {erreur.message}
            {erreur.reconnexion ? <> <a href={connexion}>Se reconnecter</a></> : null}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={enCours}>
          {enCours ? 'Vérification…' : 'Vérifier'}
        </button>
      </form>
      <button className="btn btn-ghost" type="button" onClick={changerDeMode} disabled={enCours}>
        {secours ? 'Utiliser l’application d’authentification' : 'Utiliser un code de secours'}
      </button>
      <p className="auth-alt">
        <a href={connexion}>Retour à la connexion</a>
      </p>
      </div>
    </main>
  );
}
