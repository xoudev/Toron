import { verifyExport } from '@toron/db';
import { BrandMark, PoinconMark } from '@toron/ui';
import type { Metadata } from 'next';

import { appDb } from '@/lib/db';

import { HashComparator } from './hash-comparator';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Vérification de document — Toron',
  robots: { index: false },
};

const TYPE_LABEL: Record<string, string> = {
  soa: 'Déclaration d’applicabilité (SoA)',
  pv: 'Procès-verbal de revue de direction',
  ebios: 'Livrable EBIOS RM',
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

export default async function VerifierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Vérification publique : fonction SECURITY DEFINER, sans contexte tenant,
  // exposant uniquement type / empreinte / date (ADR-6).
  const verified = await verifyExport(appDb().db, slug);

  if (!verified) {
    return (
      <main className="verify-page">
        <div className="verify-card verify-unknown">
          <span className="poincon-ghost">
            <PoinconMark size={40} />
          </span>
          <h1 style={{ marginTop: 12 }}>Poinçon introuvable</h1>
          <p style={{ marginTop: 8 }}>
            Aucun document scellé ne correspond à cette référence. Vérifiez le lien, ou le poinçon
            imprimé sur le document.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="verify-page">
      <div className="verify-card">
        <div className="verify-brand">
          <span style={{ color: 'var(--text)' }}>
            <BrandMark size={22} />
          </span>
          <span className="wordmark">toron</span>
          <span className="tag">Vérification d’intégrité</span>
        </div>

        <h1>Document scellé authentique</h1>
        <p style={{ color: 'var(--text-2)', fontSize: '12.5px', marginTop: 6 }}>
          Ce document a été généré et scellé par Toron. Son empreinte cryptographique est enregistrée
          et n’a pas changé depuis son émission.
        </p>

        <div className="verify-meta">
          <div>
            <span className="label">Type</span> {TYPE_LABEL[verified.type] ?? verified.type}
          </div>
          <div>
            <span className="label">Scellé le</span> {DATE_FORMAT.format(verified.sealedAt)}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <span className="verify-meta">
            <span className="label">SHA-256</span>
          </span>
          <div className="hash-mono" aria-label="Empreinte SHA-256 scellée">
            {verified.sha256}
          </div>
        </div>

        <HashComparator expectedSha256={verified.sha256} />
      </div>
    </main>
  );
}
