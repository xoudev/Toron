'use client';

import { useEffect, useRef, useState } from 'react';

import { authClient } from '@/lib/auth-client';

// Même texte que le compte existe ou non : la page ne dit rien de
// l'existence d'une adresse.
const DEMANDE_ENREGISTREE =
  'Demande enregistrée. Si un compte Toron utilise cette adresse, un e-mail vient de partir avec un lien valable 30 minutes. Pensez à vérifier vos courriers indésirables. Rien reçu d’ici 10 minutes ? Vérifiez l’adresse saisie puis refaites une demande.';

function messageEchec(status: number): string {
  if (status === 400) return 'Adresse e-mail invalide — vérifiez la saisie (exemple : prenom.nom@entreprise.fr).';
  if (status === 429) return 'Trop de demandes depuis votre connexion — patientez quelques minutes puis réessayez.';
  return 'Demande impossible pour le moment — vérifiez votre connexion puis réessayez.';
}

interface Annonce {
  texte: string;
  role: 'status' | 'alert';
}

export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState('');
  const [annonce, setAnnonce] = useState<Annonce | null>(null);
  const [enCours, setEnCours] = useState(false);
  const annonceRef = useRef<HTMLParagraphElement>(null);

  // Le focus suit chaque nouvelle annonce : le résultat est lu aussitôt,
  // et la suite (lien de retour, nouvelle demande) est atteinte au clavier.
  useEffect(() => {
    if (annonce) annonceRef.current?.focus();
  }, [annonce]);

  async function demander(e: React.FormEvent) {
    e.preventDefault();
    setAnnonce(null);
    setEnCours(true);
    const { error } = await authClient
      .requestPasswordReset({ email: email.trim() })
      // Réseau indisponible : message générique, sans laisser le bouton bloqué.
      .catch(() => ({ error: { status: 0 } }));
    setEnCours(false);
    setAnnonce(error ? { texte: messageEchec(error.status), role: 'alert' } : { texte: DEMANDE_ENREGISTREE, role: 'status' });
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
      <h1>Mot de passe oublié</h1>
      <p id="oublie-aide">
        Indiquez l’adresse e-mail de votre compte Toron : vous recevrez un lien pour choisir un nouveau mot de passe.
      </p>
      <form onSubmit={demander}>
        <label>
          Adresse e-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-describedby="oublie-aide"
            required
          />
        </label>
        {annonce ? (
          <p ref={annonceRef} role={annonce.role} tabIndex={-1}>
            {annonce.texte}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={enCours}>
          {enCours ? 'Envoi…' : 'Recevoir le lien'}
        </button>
      </form>
      <p className="auth-alt">
        <a href="/connexion">Revenir à la connexion</a>
      </p>
      </div>
    </main>
  );
}
