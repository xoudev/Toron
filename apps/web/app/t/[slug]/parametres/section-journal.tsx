'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { verifyJournalAction, type JournalCheck } from './actions';
import type { JournalPage } from './parametres-client';

const ACTION_FILTERS: { label: string; prefix: string }[] = [
  { label: 'Toutes les actions', prefix: '' },
  { label: 'Organisation & périmètres', prefix: 'organisation.' },
  { label: 'Membres & invitations', prefix: 'membership.' },
  { label: 'Invitations', prefix: 'invitation.' },
  { label: 'Risques', prefix: 'risk.' },
  { label: 'Plan d’action', prefix: 'action.' },
  { label: 'Documents', prefix: 'document.' },
  { label: 'Preuves', prefix: 'evidence.' },
  { label: 'Incidents', prefix: 'incident.' },
  { label: 'Non-conformités', prefix: 'nc.' },
  { label: 'Contrôles', prefix: 'control.' },
  { label: 'Évaluations', prefix: 'assessment.' },
  { label: 'Livrables scellés', prefix: 'export.' },
  { label: 'Exports de registres', prefix: 'register.' },
  { label: 'Import', prefix: 'import.' },
  { label: 'Données', prefix: 'tenant.' },
  { label: 'Vérifications du journal', prefix: 'journal.' },
];

function fmt(d: Date): string {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const shortHash = (h: string): string => `${h.slice(0, 16)}…`;

function ChainPanel({ slug, head }: { slug: string; head: JournalPage['head'] }) {
  const router = useRouter();
  const [check, setCheck] = useState<JournalCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function verify() {
    setError(null);
    start(async () => {
      const res = await verifyJournalAction(slug);
      if (res.ok) { setCheck(res.data); router.refresh(); } else setError(res.error.message);
    });
  }

  return (
    <section className={`journal-chain${check ? (check.intact ? ' is-ok' : ' is-broken') : ''}`} aria-label="Intégrité du journal">
      <div className="journal-chain-head">
        <div>
          <b>Chaîne d’intégrité</b>
          <p className="hint">
            {head ? (
              <>Dernière entrée n° {head.seq.toLocaleString('fr-FR')} · empreinte <code className="ds-mono" title={head.hash}>{shortHash(head.hash)}</code></>
            ) : 'Aucune entrée pour l’instant.'}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={verify} disabled={pending || !head}>
          {pending ? 'Vérification…' : 'Vérifier l’intégrité'}
        </button>
      </div>
      {check ? (
        <div className="journal-chain-result" role="status">
          <span className={`pill ${check.intact ? 'pill--ok' : 'pill--danger'}`}>{check.title}</span>
          <p>{check.detail}</p>
          <p className="hint">
            Vérifiée le {fmt(new Date(check.checkedAt))}
            {check.headHash ? <> sur la tête <code className="ds-mono" title={check.headHash}>{shortHash(check.headHash)}</code></> : null}
            {' '}— la vérification est elle-même inscrite au journal.
          </p>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function SectionJournal({ slug, journal }: { slug: string; journal: JournalPage }) {
  const pages = Math.max(1, Math.ceil(journal.total / journal.pageSize));
  const base = `/t/${slug}/parametres?section=journal`;
  const withFilter = (page: number) => `${base}${journal.filtre ? `&filtre=${encodeURIComponent(journal.filtre)}` : ''}${page > 1 ? `&page=${page}` : ''}`;
  const csv = `/t/${slug}/parametres/journal${journal.filtre ? `?filtre=${encodeURIComponent(journal.filtre)}` : ''}`;

  return (
    <article className="card settings-card">
      <div className="settings-card-head">
        <div>
          <h2>Journal d’audit</h2>
          <p className="hint">
            Chaque action métier, connexion à une organisation et export y est tracé avec son auteur, son
            horodatage et l’adresse IP d’origine. Le journal est en écriture seule : rien ne s’y modifie
            ni ne s’en efface. Chaque entrée est numérotée et scellée par une empreinte SHA-256 qui couvre
            la précédente : une altération faite hors de l’application, même directement en base, se détecte.
          </p>
        </div>
        <a className="btn btn-ghost btn-sm" href={csv} download>Exporter en CSV</a>
      </div>

      <ChainPanel slug={slug} head={journal.head} />

      <form method="get" action={`/t/${slug}/parametres`} className="journal-filters">
        <input type="hidden" name="section" value="journal" />
        <label className="field" style={{ margin: 0, minWidth: 220 }}>
          <select name="filtre" defaultValue={journal.filtre} aria-label="Filtrer le journal" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            {ACTION_FILTERS.map((f) => <option key={f.prefix} value={f.prefix}>{f.label}</option>)}
          </select>
        </label>
        <noscript><button className="btn btn-ghost btn-sm" type="submit">Filtrer</button></noscript>
        <span className="ds-muted">{journal.total} entrée{journal.total > 1 ? 's' : ''}</span>
      </form>

      <div className="ds-table-card"><div className="ds-scroll">
        <table className="ds-table" style={{ minWidth: 880 }}>
          <thead><tr><th style={{ width: 70 }}>N°</th><th style={{ width: 160 }}>Horodatage</th><th style={{ width: 160 }}>Acteur</th><th>Action</th><th style={{ width: 130 }}>Objet</th><th style={{ width: 120 }}>IP</th></tr></thead>
          <tbody>
            {journal.rows.length === 0 ? (
              <tr><td colSpan={6} className="ds-empty">Aucune entrée pour ce filtre.</td></tr>
            ) : journal.rows.map((a) => (
              <tr key={a.id} style={{ cursor: 'default' }}>
                <td className="ds-mono" title={`Empreinte ${a.hash}`}>{a.seq}</td>
                <td className="ds-mono">{fmt(a.at)}</td>
                <td>{a.actorName ?? <span className="ds-muted">Système</span>}</td>
                <td><span className="ds-id">{a.action}</span></td>
                <td className="ds-muted">{a.objectType}</td>
                <td className="ds-mono">{a.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>

      <div className="journal-pager">
        <span>Page {journal.page} sur {pages}</span>
        <nav aria-label="Pagination du journal">
          {journal.page > 1 ? <a className="btn btn-ghost btn-sm" href={withFilter(journal.page - 1)}>Précédente</a> : null}
          {journal.page < pages ? <a className="btn btn-ghost btn-sm" href={withFilter(journal.page + 1)}>Suivante</a> : null}
        </nav>
      </div>
    </article>
  );
}
