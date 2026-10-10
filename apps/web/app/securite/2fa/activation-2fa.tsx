'use client';

import { BrandMark } from '@toron/ui';
import { useEffect, useState } from 'react';

import { QrCode } from '@/components/qr-code';
import { authClient } from '@/lib/auth-client';

type Etape = 'mot_de_passe' | 'verification' | 'active';

/** Clé lisible pour la saisie manuelle : groupes de 4 caractères. */
function groupedSecret(totpUri: string): string {
  try {
    const secret = new URL(totpUri).searchParams.get('secret') ?? '';
    return secret.replace(/(.{4})/g, '$1 ').trim();
  } catch {
    return '';
  }
}

export function Activation2fa({ suite, retour }: { suite: string; retour: string }) {
  const [etape, setEtape] = useState<Etape>('mot_de_passe');
  const [password, setPassword] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [copie, setCopie] = useState(false);

  // Quitter l'étape « Scanner » obligerait à régénérer la clé : l'entrée déjà
  // scannée et les codes de secours enregistrés deviendraient inutilisables.
  useEffect(() => {
    if (etape !== 'verification') return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [etape]);

  async function demarrer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    const { data, error } = await authClient.twoFactor
      .enable({ password })
      // Réseau indisponible : message générique, sans laisser le bouton bloqué.
      .catch(() => ({ data: null, error: { status: 0, code: undefined } }));
    setEnCours(false);
    if (error?.status === 401) {
      window.location.assign(`/connexion?suite=${encodeURIComponent(suite)}`);
      return;
    }
    if (error || !data) {
      setErreur(
        error?.code === 'TOTP_ALREADY_ENABLED'
          ? 'La double authentification est déjà active sur votre compte — rechargez la page pour continuer.'
          : error?.code === 'INVALID_PASSWORD'
            ? 'Mot de passe incorrect — saisissez celui de votre compte Toron puis réessayez.'
            : error?.status === 429
              ? 'Trop de tentatives — patientez jusqu’à une minute puis réessayez.'
              : 'Activation impossible pour le moment — réessayez dans quelques instants.',
      );
      return;
    }
    // better-auth renvoie, selon la méthode configurée, un OTP ou un TOTP : seul
    // le TOTP est utilisé ici, toute autre réponse est refusée explicitement.
    if (!('totpURI' in data)) {
      setErreur("Activation impossible : la méthode TOTP n'est pas disponible pour ce compte. Contactez l'administrateur de votre organisation.");
      return;
    }
    setPassword('');
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setEtape('verification');
  }

  async function confirmer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    const { error } = await authClient.twoFactor
      .verifyTotp({ code: code.replace(/\s/g, '') })
      .catch(() => ({ error: { status: 0 } }));
    setEnCours(false);
    if (error) {
      setErreur(
        error.status === 429
          ? 'Trop de tentatives — patientez jusqu’à une minute puis réessayez.'
          : error.status === 400 || error.status === 401
            ? 'Code refusé — vérifiez que l’heure de votre téléphone est automatique, puis saisissez le code affiché à l’instant. Si vous avez scanné un QR code précédent, supprimez cette entrée et scannez celui-ci.'
            : 'Vérification impossible pour le moment — réessayez dans quelques instants.',
      );
      return;
    }
    setTotpUri('');
    setEtape('active');
  }

  async function copierCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopie(true);
    } catch {
      setCopie(false);
    }
  }

  function telechargerCodes() {
    const contenu = `Codes de secours Toron — à usage unique, à conserver hors ligne.\n\n${backupCodes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([contenu], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'toron-codes-de-secours.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="auth-page">
      <div className="auth-card totp-card">
        <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
        <h1>Activer la double authentification</h1>
        <ol className="totp-steps" aria-label="Étapes">
          <li aria-current={etape === 'mot_de_passe' ? 'step' : undefined}>Confirmer</li>
          <li aria-current={etape === 'verification' ? 'step' : undefined}>Scanner</li>
          <li aria-current={etape === 'active' ? 'step' : undefined}>Terminé</li>
        </ol>

        {etape === 'mot_de_passe' ? (
          <form onSubmit={demarrer}>
            <p>
              Un code à 6 chiffres, renouvelé toutes les 30 secondes sur votre téléphone, vous sera demandé
              à chaque connexion. Il est obligatoire pour les rôles Propriétaire, Direction et RSSI.
              Confirmez d’abord votre mot de passe.
            </p>
            <label>
              Mot de passe
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            {erreur ? <p role="alert">{erreur}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={enCours}>{enCours ? 'Génération…' : 'Générer la clé'}</button>
          </form>
        ) : null}

        {etape === 'verification' ? (
          <form onSubmit={confirmer}>
            <p>
              Scannez ce QR code avec votre application d’authentification (Authenticator, FreeOTP,
              Bitwarden, 1Password…), puis saisissez le code qu’elle affiche.
            </p>
            <div className="totp-qr">
              <QrCode value={totpUri} label="QR code de configuration de la double authentification" />
            </div>
            <p>
              Si vous quittez cette page, une nouvelle clé sera générée : supprimez alors l’entrée Toron
              précédente de votre application et jetez les codes déjà enregistrés.
            </p>
            <details className="totp-manual">
              <summary>Impossible de scanner ? Saisir la clé à la main</summary>
              <code className="totp-secret">{groupedSecret(totpUri)}</code>
              <small>Type : basé sur le temps · 6 chiffres · 30 secondes</small>
            </details>
            <div className="totp-backup">
              <b>Codes de secours</b>
              <small>Chacun permet une connexion si vous perdez votre téléphone. Conservez-les hors ligne : ils ne seront plus affichés.</small>
              <code>{backupCodes.join('  ')}</code>
              <div className="totp-backup-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={telechargerCodes}>Télécharger</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={copierCodes}>{copie ? 'Copiés' : 'Copier'}</button>
              </div>
            </div>
            <label>
              Code à 6 chiffres
              <input inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required autoFocus />
            </label>
            {erreur ? <p role="alert">{erreur}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={enCours}>{enCours ? 'Vérification…' : 'Confirmer l’activation'}</button>
          </form>
        ) : null}

        {etape === 'active' ? (
          <>
            <p role="status">
              Double authentification activée. Votre application vous donnera désormais le code à saisir
              après votre mot de passe.
            </p>
            <a className="btn btn-primary" href={retour}>{retour === '/organisations' ? 'Continuer vers vos organisations' : 'Continuer'}</a>
          </>
        ) : null}
      </div>
    </main>
  );
}
