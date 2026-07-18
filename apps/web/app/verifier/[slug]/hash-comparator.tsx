'use client';

import { useState } from 'react';

/**
 * Comparateur d'empreinte côté client : l'utilisateur dépose le PDF reçu,
 * le SHA-256 est calculé DANS le navigateur (WebCrypto) et comparé à
 * l'empreinte scellée. Le fichier ne quitte jamais le poste (privacy).
 */
export function HashComparator({ expectedSha256 }: { expectedSha256: string }) {
  const [result, setResult] = useState<'match' | 'mismatch' | null>(null);
  const [computed, setComputed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    setResult(null);
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    setComputed(hex);
    setResult(hex === expectedSha256.toLowerCase() ? 'match' : 'mismatch');
    setBusy(false);
  }

  return (
    <div className="verify-compare">
      <h2>Vérifier un fichier</h2>
      <p>
        Déposez le PDF que vous avez reçu : son empreinte est calculée localement et comparée à
        celle scellée ci-dessus. Le fichier ne quitte pas votre navigateur.
      </p>
      <input
        type="file"
        accept="application/pdf"
        aria-label="Fichier PDF à vérifier"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
        style={{ marginTop: 10, fontSize: 12 }}
      />
      {busy ? <p style={{ marginTop: 8, fontSize: 12 }}>Calcul de l’empreinte…</p> : null}
      {result === 'match' ? (
        <div className="verify-result verify-result--match" role="status">
          ✓ Le fichier correspond exactement au document scellé — intégrité confirmée.
        </div>
      ) : null}
      {result === 'mismatch' ? (
        <div className="verify-result verify-result--mismatch" role="status">
          ✗ Empreinte différente — ce fichier n’est pas le document scellé (ou a été modifié).
        </div>
      ) : null}
      {computed && result === 'mismatch' ? (
        <div className="hash-mono" aria-label="Empreinte du fichier déposé">
          {computed}
        </div>
      ) : null}
    </div>
  );
}
