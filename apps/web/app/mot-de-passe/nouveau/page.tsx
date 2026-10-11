'use client';

import {
  PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordPolicyVerdict, readResetFragment, type PasswordPolicyCode,
} from '@toron/core';
import { useEffect, useRef, useState } from 'react';

import { authClient } from '@/lib/auth-client';

const DEMANDE = '/mot-de-passe/oublie';

const LIEN_INCOMPLET =
  'Lien incomplet — ouvrez le lien exactement tel qu’il figure dans l’e-mail (partie après «\u202f#\u202f» comprise), ou demandez un nouveau lien.';
const LIEN_PERIME =
  'Ce lien n’est plus valable : il a expiré (30 minutes), a déjà servi, ou une demande plus récente l’a remplacé. Demandez un nouveau lien.';
const SUCCES =
  'Mot de passe modifié. Toutes vos sessions ont été fermées. Connectez-vous avec votre nouveau mot de passe ; si la double authentification est activée, votre code vous sera demandé.';

const POLITIQUE: Record<PasswordPolicyCode, string> = {
  TROP_COURT: `Mot de passe trop court — ${PASSWORD_MIN_LENGTH} caractères minimum. Le lien reste valable.`,
  TROP_LONG: `Mot de passe trop long — ${PASSWORD_MAX_LENGTH} caractères maximum.`,
  DIFFERENTS: 'Les deux saisies diffèrent — retapez le mot de passe à l’identique dans les deux champs.',
};

/** Message d'échec selon la cause renvoyée par Better Auth. */
function messageEchec(error: { code?: string; status: number }): string {
  if (error.code === 'PASSWORD_TOO_SHORT') return POLITIQUE.TROP_COURT;
  if (error.code === 'PASSWORD_TOO_LONG') return POLITIQUE.TROP_LONG;
  if (error.status === 429) {
    return 'Trop de tentatives depuis votre connexion — patientez quelques minutes puis réessayez ; votre lien reste valable jusqu’à son expiration.';
  }
  // Le jeton peut avoir été consommé avant l'échec, ou la réponse perdue
  // après l'enregistrement : rien n'est promis sur le lien.
  return 'Enregistrement impossible pour le moment — vérifiez votre connexion puis réessayez ; si le lien est alors refusé, demandez-en un nouveau.';
}

type Etape = 'lecture' | 'saisie' | 'incomplet' | 'perime' | 'termine';

export default function NouveauMotDePassePage() {
  // Jeton lu une seule fois, au premier rendu dans le navigateur, et gardé en
  // mémoire seulement : le mode strict rejoue les effets alors que le
  // fragment a déjà quitté la barre d'adresse.
  const jeton = useRef(typeof window === 'undefined' ? null : readResetFragment(window.location.hash));
  const [etape, setEtape] = useState<Etape>('lecture');
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<{ texte: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const annonceRef = useRef<HTMLParagraphElement>(null);

  // Rien n'est envoyé ici : un analyseur de liens qui exécute le JavaScript
  // ne consomme pas le jeton. Le fragment quitte l'historique aussitôt.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    setEtape(jeton.current ? 'saisie' : 'incomplet');

    // Lien collé dans cet onglet : seul le fragment change, sans rechargement.
    function relireFragment() {
      if (!window.location.hash) return;
      const lu = readResetFragment(window.location.hash);
      window.history.replaceState(null, '', window.location.pathname);
      jeton.current = lu;
      setErreur(null);
      setMotDePasse('');
      setConfirmation('');
      setEtape(lu ? 'saisie' : 'incomplet');
    }
    window.addEventListener('hashchange', relireFragment);
    return () => window.removeEventListener('hashchange', relireFragment);
  }, []);

  useEffect(() => {
    if (erreur || etape === 'incomplet' || etape === 'perime' || etape === 'termine') annonceRef.current?.focus();
  }, [erreur, etape]);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const verdict = passwordPolicyVerdict(motDePasse, confirmation);
    if (verdict) {
      setErreur({ texte: POLITIQUE[verdict] });
      return;
    }
    const token = jeton.current;
    if (!token) {
      setEtape('incomplet');
      return;
    }
    setEnCours(true);
    let error: { code?: string; status: number } | null;
    try {
      // Jeton dans le corps de la requête, jamais dans l'adresse.
      ({ error } = await authClient.resetPassword({ newPassword: motDePasse, token }));
    } catch {
      // Réseau indisponible : message générique, sans laisser le bouton bloqué.
      error = { status: 0 };
    }
    setEnCours(false);
    if (error?.code === 'INVALID_TOKEN' || error?.code === 'USER_NOT_FOUND') {
      jeton.current = null;
      setEtape('perime');
      return;
    }
    if (error) {
      setErreur({ texte: messageEchec(error) });
      return;
    }
    // Aucune session n'est ouverte : la connexion repasse par le mot de
    // passe, puis par le second facteur s'il est activé.
    jeton.current = null;
    setMotDePasse('');
    setConfirmation('');
    setEtape('termine');
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
      <h1>Nouveau mot de passe</h1>
      {etape === 'incomplet' ? (
        <p ref={annonceRef} role="alert" tabIndex={-1}>
          {LIEN_INCOMPLET} <a href={DEMANDE}>Demander un nouveau lien</a>
        </p>
      ) : null}
      {etape === 'perime' ? (
        <p ref={annonceRef} role="alert" tabIndex={-1}>
          {LIEN_PERIME} <a href={DEMANDE}>Demander un nouveau lien</a>
        </p>
      ) : null}
      {etape === 'termine' ? (
        <>
          <p ref={annonceRef} role="status" tabIndex={-1}>{SUCCES}</p>
          <a className="btn btn-primary" href="/connexion">Se connecter</a>
        </>
      ) : null}
      {etape === 'saisie' ? (
        <form onSubmit={enregistrer} noValidate>
          <label>
            Nouveau mot de passe
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              aria-describedby="nouveau-aide"
              required
              autoFocus
            />
          </label>
          <p id="nouveau-aide" className="auth-hint">{PASSWORD_MIN_LENGTH} caractères minimum ; une phrase de plusieurs mots est idéale.</p>
          <label>
            Confirmer le mot de passe
            <input
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              required
            />
          </label>
          {erreur ? (
            <p ref={annonceRef} role="alert" tabIndex={-1}>
              {erreur.texte}
            </p>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={enCours}>
            {enCours ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
          </button>
        </form>
      ) : null}
      {etape === 'termine' ? null : (
        <p className="auth-alt">
          <a href="/connexion">Revenir à la connexion</a>
        </p>
      )}
      </div>
    </main>
  );
}
