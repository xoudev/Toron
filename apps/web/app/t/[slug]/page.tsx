import { getDashboardExtras, getDashboardMetrics, listProcesses, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

export const dynamic = 'force-dynamic';

const BANDS = ['critique', 'eleve', 'moyen', 'faible'] as const;

export default async function TenantAccueilPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);

  // non_connecte est redirigé par le layout.
  if (ctx.verdict === 'refuse' || ctx.verdict === 'non_connecte') {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Accès refusé</h1>
          <p>
            Cette organisation n’existe pas ou vous n’en êtes pas membre — vérifiez l’adresse, ou
            demandez une invitation à son administrateur.
          </p>
          <p className="auth-alt">
            <a href="/organisations">Retour à vos organisations</a>
          </p>
        </div>
      </main>
    );
  }

  if (ctx.verdict === 'totp_requis') {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>{ctx.tenantName}</h1>
          <p>
            Votre rôle exige la double authentification (TOTP) — activez-la pour accéder à cette
            organisation.
          </p>
          <p className="auth-alt">
            <a href="/securite/2fa">Activer la double authentification</a>
          </p>
        </div>
      </main>
    );
  }

  const { m, x, processesAlert } = await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    const procs = await listProcesses(tx);
    return {
      m: await getDashboardMetrics(tx),
      x: await getDashboardExtras(tx),
      processesAlert: procs.filter((p) => p.health === 'en_alerte').length,
    };
  });
  const base = `/t/${slug}`;
  const maxBand = Math.max(1, ...Object.values(m.risksByBand));

  // Priorités concrètes de la semaine, dérivées des indicateurs (seuls les
  // points réellement à traiter sont listés).
  const priorities = [
    { n: m.actionsOverdue, one: 'action en retard', many: 'actions en retard', href: `${base}/plan-action`, tone: 'danger' as const },
    { n: x.incidentsOpen, one: 'incident en cours (échéances NIS 2)', many: 'incidents en cours (échéances NIS 2)', href: `${base}/incidents`, tone: 'danger' as const },
    { n: x.ncOpen, one: 'non-conformité ouverte', many: 'non-conformités ouvertes', href: `${base}/non-conformites`, tone: 'warn' as const },
    { n: m.risksAttention, one: 'acceptation de risque à traiter', many: 'acceptations de risque à traiter', href: `${base}/risques`, tone: 'warn' as const },
    { n: m.evidencesStale, one: 'preuve à renouveler', many: 'preuves à renouveler', href: `${base}/preuves`, tone: 'warn' as const },
    { n: m.documentsReviewOverdue, one: 'document à revoir', many: 'documents à revoir', href: `${base}/documents`, tone: 'warn' as const },
    { n: processesAlert, one: 'processus en alerte', many: 'processus en alerte', href: `${base}/processus`, tone: 'warn' as const },
  ].filter((p) => p.n > 0);

  const mgmt = [
    { label: 'Audits en cours', value: x.auditsInProgress, href: `${base}/audits` },
    { label: 'Non-conformités ouvertes', value: x.ncOpen, href: `${base}/non-conformites` },
    { label: 'Incidents en cours', value: x.incidentsOpen, href: `${base}/incidents` },
    { label: 'Processus cartographiés', value: x.processesTotal, sub: processesAlert > 0 ? `${processesAlert} en alerte` : 'santé OK', href: `${base}/processus` },
    { label: 'Revues de direction tenues', value: x.reviewsHeld, href: `${base}/revue-direction` },
    { label: 'Référentiels au catalogue', value: x.frameworksAvailable, sub: `${x.requirementsTotal} exigences`, href: `${base}/referentiels` },
  ];

  return (
    <>
      <Topbar crumbRoot={ctx.tenantName} crumbCurrent="Tableau de bord" actions={<ThemeToggle />} />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Tableau de bord</h1>
            <p className="sub">Périmètre SMSI + QMS · 148 salariés · 3 sites</p>
          </div>
        </div>

        <div className="kpi-grid">
          <a className="card kpi kpi--ok" href={`${base}/referentiels`}>
            <span className="kpi-label">Couverture de conformité</span>
            <span className="kpi-value">{m.coveragePct === null ? '—' : `${m.coveragePct}%`}</span>
            <div className="coverage-bar" aria-hidden="true">
              <span style={{ width: `${m.coveragePct ?? 0}%` }} />
            </div>
            <span className={`kpi-sub${m.gaps > 0 ? ' alert' : ''}`}>
              {m.gaps} écart{m.gaps > 1 ? 's' : ''} · {m.frameworksActive} référentiel{m.frameworksActive > 1 ? 's' : ''} actif{m.frameworksActive > 1 ? 's' : ''}
            </span>
          </a>

          <a className="card kpi" href={`${base}/referentiels`}>
            <span className="kpi-label">Contrôles</span>
            <span className="kpi-value">{m.controlsTotal}</span>
            <span className="kpi-sub">{m.controlsMutualized} mutualisé{m.controlsMutualized > 1 ? 's' : ''} — prouvés une fois</span>
          </a>

          <a className={`card kpi ${m.risksAttention > 0 ? 'kpi--danger' : ''}`} href={`${base}/risques`}>
            <span className="kpi-label">Risques</span>
            <span className="kpi-value">{m.risksTotal}</span>
            <div className="risk-spark" aria-hidden="true">
              {BANDS.map((b) => (
                <span
                  key={b}
                  className={`risk-spark-seg seg--${b}`}
                  style={{ opacity: m.risksByBand[b] === 0 ? 0.25 : 0.4 + 0.6 * (m.risksByBand[b] / maxBand) }}
                  title={`${m.risksByBand[b]} ${b}`}
                />
              ))}
            </div>
            <span className={`kpi-sub${m.risksAttention > 0 ? ' alert' : ''}`}>
              {m.risksAttention > 0 ? `${m.risksAttention} acceptation${m.risksAttention > 1 ? 's' : ''} à traiter` : 'Acceptations à jour'}
            </span>
          </a>

          <a className={`card kpi ${m.actionsOverdue > 0 ? 'kpi--danger' : 'kpi--warn'}`} href={`${base}/plan-action`}>
            <span className="kpi-label">Plan d’action</span>
            <span className="kpi-value">{m.actionsOpen}</span>
            <span className={`kpi-sub${m.actionsOverdue > 0 ? ' alert' : ''}`}>
              {m.actionsOverdue > 0 ? `${m.actionsOverdue} en retard` : 'Aucune en retard'}
            </span>
          </a>

          <a className={`card kpi ${m.evidencesStale > 0 ? 'kpi--warn' : 'kpi--ok'}`} href={`${base}/preuves`}>
            <span className="kpi-label">Preuves</span>
            <span className="kpi-value">{m.evidencesTotal}</span>
            <span className={`kpi-sub${m.evidencesStale > 0 ? ' alert' : ''}`}>
              {m.evidencesStale > 0 ? `${m.evidencesStale} à renouveler` : 'Toutes fraîches'}
            </span>
          </a>

          <a className={`card kpi ${m.documentsReviewOverdue > 0 ? 'kpi--warn' : ''}`} href={`${base}/documents`}>
            <span className="kpi-label">Documents</span>
            <span className="kpi-value">{m.documentsTotal}</span>
            <span className={`kpi-sub${m.documentsReviewOverdue > 0 ? ' alert' : ''}`}>
              {m.documentsReviewOverdue > 0 ? `${m.documentsReviewOverdue} à revoir` : 'Revues à jour'}
            </span>
          </a>
        </div>

        <div className="dash-cols">
          <article className="card dash-panel">
            <div className="dash-panel-head">
              <h2>Priorités de la semaine</h2>
              <span className="dash-panel-count">{priorities.length}</span>
            </div>
            {priorities.length === 0 ? (
              <p className="dash-allclear">✓ Rien d’urgent — tout est à jour. Beau travail.</p>
            ) : (
              <ul className="dash-list">
                {priorities.map((p) => (
                  <li key={p.href + p.one}>
                    <a href={p.href}>
                      <span className={`dash-dot dot--${p.tone}`} aria-hidden="true" />
                      <b className="mono">{p.n}</b> {p.n > 1 ? p.many : p.one}
                      <span className="dash-arrow" aria-hidden="true">→</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="card dash-panel">
            <div className="dash-panel-head">
              <h2>Système de management</h2>
            </div>
            <div className="dash-tiles">
              {mgmt.map((t) => (
                <a className="dash-tile" href={t.href} key={t.label}>
                  <span className="dash-tile-value mono">{t.value}</span>
                  <span className="dash-tile-label">{t.label}</span>
                  {t.sub ? <span className="dash-tile-sub">{t.sub}</span> : null}
                </a>
              ))}
            </div>
          </article>
        </div>

        <article className="card" style={{ padding: 16 }}>
          <p style={{ color: 'var(--text-2)', fontSize: '12.5px', margin: 0 }}>
            <b>Prouvez une fois. Couvrez tout.</b> Chaque indicateur pointe vers son module — la
            couverture provient de la dernière campagne d’évaluation par référentiel, les contrôles
            mutualisés satisfont plusieurs cadres à la fois.
          </p>
        </article>
      </main>
    </>
  );
}
