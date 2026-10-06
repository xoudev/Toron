import {
  canConfigureOrganisation,
  NIS2_REGISTRATION_LABEL,
  NIS2_STATUS_LABEL,
  OBLIGATION_REGIME_LABEL,
} from '@toron/core';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { listExportsForObject, loadBoardReport, withTenant } from '@toron/db';

import { appDb } from '@/lib/db';
import { frDate, refCode, todayParis } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { PrintButton } from './print-button';
import { SealedVersions, type SealedVersion } from './sealed-versions';

export const dynamic = 'force-dynamic';

const BAND_LABEL: Record<string, string> = { critique: 'Critique', eleve: 'Élevé', moyen: 'Moyen', faible: 'Faible' };
const TREATMENT_LABEL: Record<string, string> = { reduire: 'Réduire', transferer: 'Transférer', accepter: 'Accepter', eviter: 'Éviter' };
const TONE_LABEL = { alerte: 'Alerte', vigilance: 'Vigilance', positif: 'Point positif' } as const;
const STAMP = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });

export default async function RapportDirectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);

  const today = todayParis();
  const { r, exports } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    r: await loadBoardReport(tx, today),
    exports: (await listExportsForObject(tx, ctx.tenantId)).filter((e) => e.type === 'rapport'),
  }));
  const versions: SealedVersion[] = exports.map((e) => ({
    id: e.id, status: e.status, sha256: e.sha256, verifySlug: e.verifySlug,
    sealedAtLabel: e.sealedAt ? STAMP.format(e.sealedAt) : null, requestedAtLabel: STAMP.format(e.createdAt),
  }));
  const i = r.input;
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)} %` : '—');

  return (
    <>
      <Topbar crumbRoot="Pilotage" crumbCurrent="Rapport de direction" actions={<><PrintButton /><ThemeToggle /></>} />
      <main className="app-page board">
        <header className="board-head">
          <p className="board-kicker">Rapport de direction</p>
          <h1>{r.organisationName}</h1>
          <p className="sub">{r.headline} · situation au {frDate(today)}</p>
        </header>

        <section className="board-section" aria-labelledby="b-messages">
          <h2 id="b-messages">Messages clés</h2>
          {r.messages.length === 0 ? <p className="ds-muted">Pas assez de données pour dégager des messages : complétez les registres.</p> : (
            <ul className="board-messages">
              {r.messages.map((m) => <li key={m.text} className={`board-msg board-msg--${m.tone}`}><span className="board-tone">{TONE_LABEL[m.tone]}</span>{m.text}</li>)}
            </ul>
          )}
        </section>

        <section className="board-section" aria-labelledby="b-decisions">
          <h2 id="b-decisions">Décisions attendues de la direction</h2>
          {r.decisions.length === 0 ? <p className="ds-muted">Aucun arbitrage en attente.</p> : <ol className="board-decisions">{r.decisions.map((d) => <li key={d}>{d}</li>)}</ol>}
        </section>

        <section className="board-section" aria-labelledby="b-kpi">
          <h2 id="b-kpi">Indicateurs</h2>
          <dl className="board-kpis">
            <div><dt>Couverture des exigences évaluées</dt><dd>{i.coveragePct === null ? '—' : `${i.coveragePct} %`}</dd></div>
            {i.risks ? <div><dt>Risques critiques / élevés (nets)</dt><dd>{i.risks.critical} / {i.risks.high}</dd></div> : null}
            <div><dt>Actions en retard / ouvertes</dt><dd>{i.actions.overdue} / {i.actions.open}</dd></div>
            <div><dt>Obligations respectées</dt><dd>{i.obligations.met} / {i.obligations.applicable}</dd></div>
            {i.incidents ? <div><dt>Incidents en cours</dt><dd>{i.incidents.open}</dd></div> : null}
            <div><dt>Fiches RGPD complètes</dt><dd>{i.processing.total - i.processing.incomplete} / {i.processing.total}</dd></div>
          </dl>
        </section>

        <div className="board-grid">
          <section className="board-section" aria-labelledby="b-nis2">
            <h2 id="b-nis2">NIS 2 et obligations</h2>
            <ul className="board-list">
              {r.entities.map((e) => (
                <li key={e.name}><b>{e.name}</b> — {NIS2_STATUS_LABEL[e.status]} · enregistrement ANSSI : {NIS2_REGISTRATION_LABEL[e.registration].toLowerCase()}<small>{e.reason}</small></li>
              ))}
              {r.obligationsByRegime.map((o) => <li key={o.regime}>{OBLIGATION_REGIME_LABEL[o.regime]} : {o.met} obligation{o.met > 1 ? 's' : ''} respectée{o.met > 1 ? 's' : ''} sur {o.applicable} ({pct(o.met, o.applicable)})</li>)}
            </ul>
          </section>

          <section className="board-section" aria-labelledby="b-ref">
            <h2 id="b-ref">Conformité par référentiel</h2>
            {r.frameworks.length === 0 ? <p className="ds-muted">Aucune évaluation lancée.</p> : (
              <ul className="board-list">{r.frameworks.map((f) => <li key={f.name}><b>{f.name}</b> — {f.scorePct === null ? 'non évalué' : `${f.scorePct} % conforme`}{f.gaps > 0 ? ` · ${f.gaps} écart${f.gaps > 1 ? 's' : ''}` : ''}</li>)}</ul>
            )}
          </section>
        </div>

        {r.topRisks ? (
          <section className="board-section" aria-labelledby="b-risks">
            <h2 id="b-risks">Risques principaux</h2>
            {r.topRisks.length === 0 ? <p className="ds-muted">Aucun risque élevé ou critique après traitement.</p> : (
              <table className="board-table">
                <thead><tr><th>Risque</th><th>Niveau net</th><th>Traitement</th><th>Responsable</th></tr></thead>
                <tbody>{r.topRisks.map((x) => <tr key={x.id}><td><a href={`/t/${slug}/risques?ouvrir=${x.id}`}>{refCode('RSK', x.id)}</a> {x.title}</td><td>{x.netBand ? BAND_LABEL[x.netBand] : '—'}</td><td>{TREATMENT_LABEL[x.treatment] ?? x.treatment}</td><td>{x.ownerName ?? '—'}</td></tr>)}</tbody>
              </table>
            )}
          </section>
        ) : null}

        <section className="board-section" aria-labelledby="b-actions">
          <h2 id="b-actions">Actions en retard</h2>
          {r.overdueActions.length === 0 ? <p className="ds-muted">Aucune action en retard.</p> : (
            <table className="board-table">
              <thead><tr><th>Action</th><th>Priorité</th><th>Échéance</th><th>Responsable</th></tr></thead>
              <tbody>{r.overdueActions.map((a) => <tr key={a.id}><td><a href={`/t/${slug}/plan-action?ouvrir=${a.id}`}>{refCode('ACT', a.id)}</a> {a.title}</td><td>{a.priority.toUpperCase()}</td><td>{frDate(a.dueDate)}</td><td>{a.ownerName ?? '—'}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        <SealedVersions slug={slug} versions={versions} canSeal={canConfigureOrganisation(ctx.role)} />

        <p className="board-foot">
          Établi à partir des registres de Toron le {frDate(today)}. Les qualifications NIS 2 sont indicatives ;
          l’enregistrement auprès de l’ANSSI fait foi.
        </p>
      </main>
    </>
  );
}
