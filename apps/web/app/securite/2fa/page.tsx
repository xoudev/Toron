'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

type Etape = 'mot_de_passe' | 'verification' | 'active';

export default function Activation2faPage() {
  const [etape, setEtape] = useState<Etape>('mot_de_passe');
  const [password, setPassword] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  async function demarrer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data) {
      setErreur('Activation impossible — vérifiez votre mot de passe puis réessayez.');
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setEtape('verification');
  }

  async function confirmer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setErreur('Code invalide — scannez la clé dans votre application puis saisissez le code affiché.');
      return;
    }
    setEtape('active');
  }

  return (
    <main>
      <h1>Activer la double authentification</h1>

      {etape === 'mot_de_passe' ? (
        <form onSubmit={demarrer}>
          <p>
            Votre rôle (Direction, RSSI ou propriétaire) exige le TOTP. Confirmez votre mot de
            passe pour générer la clé.
          </p>
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
          <button type="submit">Générer la clé</button>
        </form>
      ) : null}

      {etape === 'verification' ? (
        <form onSubmit={confirmer}>
          <p>
            Ajoutez cette clé dans votre application d’authentification (saisie manuelle depuis
            l’URI ci-dessous), puis confirmez avec un premier code.
          </p>
          <p>
            <code>{totpUri}</code>
          </p>
          <p>
            Codes de secours à conserver en lieu sûr : <code>{backupCodes.join(' · ')}</code>
          </p>
          <label>
            Code à 6 chiffres
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
          <button type="submit">Confirmer l’activation</button>
        </form>
      ) : null}

      {etape === 'active' ? (
        <>
          <p>Double authentification activée.</p>
          <p>
            <a href="/organisations">Retour à vos organisations</a>
          </p>
        </>
      ) : null}
    </main>
  );
}
