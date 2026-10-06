'use client';

import type { OrganisationProfile } from '@toron/db';

import type { Viewer } from './parametres-client';

export function SectionDonnees({ slug, viewer, profile, tables }: { slug: string; viewer: Viewer; profile: OrganisationProfile; tables: string[] }) {
  return (
    <>
      <article className="card settings-card">
        <div className="settings-card-head">
          <div>
            <h2>Vos données vous appartiennent</h2>
            <p className="hint">
              Export complet de l’organisation au format JSON : référentiels internes, contrôles, risques,
              plan d’action, documents, preuves (métadonnées et empreintes), incidents, audits, revues,
              processus, non-conformités, fournisseurs, actifs, membres et journal d’audit. Aucun
              verrouillage : vous repartez avec tout, à tout moment.
            </p>
          </div>
          {viewer.canConfigure ? (
            <a className="btn btn-primary btn-sm" href={`/t/${slug}/parametres/export`} download>Exporter toutes les données</a>
          ) : <span className="pill pill--muted">Réservé aux responsables</span>}
        </div>
        <dl className="settings-kv">
          <dt>Format</dt><dd>JSON structuré, une collection par table, horodaté — importable dans un tableur ou un entrepôt de données</dd>
          <dt>Fichiers binaires</dt><dd>Les PDF scellés et pièces de preuve sont référencés par empreinte SHA-256 et taille ; ils se téléchargent depuis leurs écrans</dd>
          <dt>Traçabilité</dt><dd>Chaque export est inscrit au journal d’audit avec son auteur</dd>
          <dt>Tables incluses</dt><dd className="mono">{tables.length}</dd>
        </dl>
        <details>
          <summary className="ds-muted" style={{ cursor: 'pointer' }}>Voir la liste des tables exportées</summary>
          <p className="ds-mono" style={{ whiteSpace: 'normal', marginTop: 6, lineHeight: 1.7 }}>{tables.join(' · ')}</p>
        </details>
      </article>

      <article className="card settings-card">
        <div className="settings-card-head">
          <div>
            <h2>Hébergement et rétention</h2>
            <p className="hint">Où vivent vos données et combien de temps.</p>
          </div>
        </div>
        <dl className="settings-kv">
          <dt>Région</dt><dd>{profile.region === 'eu-fr' ? 'Union européenne · France' : profile.region}</dd>
          <dt>Organisation créée le</dt><dd className="mono">{new Date(profile.createdAt).toLocaleDateString('fr-FR')}</dd>
          <dt>Journal d’audit</dt><dd>Conservé sans limite de durée pendant la vie de l’organisation (minimum contractuel : 1 an)</dd>
          <dt>Preuves et livrables</dt><dd>Conservés tant que l’objet existe ; l’empreinte d’un livrable scellé reste vérifiable publiquement</dd>
          <dt>Sauvegardes</dt><dd>Quotidiennes avec restauration à un instant donné, testées périodiquement</dd>
        </dl>
      </article>
    </>
  );
}
