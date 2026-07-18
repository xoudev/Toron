import { canManageControls } from '@toron/core';
import { listControls, listFrameworks, listScopes, withTenant, type FrameworkSummary } from '@toron/db';
import { BrandMark, ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ActivateFrameworkButton, CreateFrameworkButton } from './catalog-client';

export const dynamic = 'force-dynamic';

const FRAMEWORK_SUBTITLE: Record<string, string> = {
  iso27001: 'SMSI · Annexe A',
  recyf: 'NIS 2 · ANSSI',
  rgpd: 'Données personnelles',
  iso9001: 'QMS',
};

function toolingRate(f: FrameworkSummary): number {
  return f.requirementCount === 0 ? 0 : Math.round((f.mappedRequirementCount / f.requirementCount) * 100);
}

// Les versions sont saisies tantôt « v2.5 » (ReCyF) tantôt « 2022 » (ISO) :
// on normalise l'affichage à un seul préfixe « v ».
function formatVersion(version: string): string {
  return `v${version.replace(/^v/i, '')}`;
}

export default async function ReferentielsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { frameworks, controls, scopes } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    frameworks: await listFrameworks(tx),
    controls: await listControls(tx),
    scopes: await listScopes(tx),
  }));

  const active = frameworks.filter((f) => f.activatedScopeCount > 0);
  const available = frameworks.filter((f) => f.activatedScopeCount === 0);
  const mutualizedCount = controls.filter((c) => c.mutualized).length;
  const activeCodes = active.map((f) => f.code.toUpperCase());

  return (
    <>
      <Topbar
        crumbRoot="Conformité"
        crumbCurrent="Référentiels"
        actions={
          <>
            <span className="topbar-crumb" style={{ marginRight: 4 }}>
              {active.length} ACTIF{active.length > 1 ? 'S' : ''}
            </span>
            {canManage ? <CreateFrameworkButton slug={slug} /> : null}
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Référentiels</h1>
            <p className="sub">
              Un contrôle, une preuve, un document peuvent satisfaire plusieurs référentiels — le
              cross-mapping les mutualise.
            </p>
          </div>
        </div>

        {active.length === 0 && available.length === 0 ? (
          <div className="empty-state">
            <span className="brand-ghost">
              <BrandMark size={34} />
            </span>
            <h2>Aucun référentiel activé</h2>
            <p>
              Activez un référentiel pour charger son arbre d’exigences, y rattacher vos contrôles
              internes, et laisser Toron mutualiser ceux qui couvrent plusieurs cadres.
            </p>
          </div>
        ) : null}

        {active.length > 0 ? (
          <>
            <div className="section-rule">
              <span className="section-rule-label">Référentiels actifs ({active.length})</span>
            </div>
            <div className="catalog-grid">
              {active.map((f) => (
                <article className="card fw-card" key={f.id}>
                  <div className="fw-card-head">
                    <div>
                      <div className="fw-card-title">{f.name}</div>
                      <div className="fw-card-meta">
                        {(FRAMEWORK_SUBTITLE[f.code] ?? f.code.toUpperCase())} · {formatVersion(f.version)}
                      </div>
                    </div>
                    <span className={`badge ${f.isBuiltin ? 'badge--builtin' : 'badge--custom'}`}>
                      {f.isBuiltin ? 'Intégré' : 'Interne'}
                    </span>
                  </div>
                  <div className="stat-row">
                    <div className="stat">
                      <div className="stat-value mono">{f.requirementCount}</div>
                      <div className="stat-label">Exigences</div>
                    </div>
                    <div className="stat">
                      <div className="stat-value mono">{f.mappedControlCount}</div>
                      <div className="stat-label">Contrôles rattachés</div>
                    </div>
                    <div className="stat">
                      <div className="stat-value mono">{f.mappedRequirementCount}</div>
                      <div className="stat-label">Exigences outillées</div>
                    </div>
                  </div>
                  <div className="tooling" title="Part d’exigences dotées d’au moins un contrôle interne">
                    <div className="tooling-track">
                      <div className="tooling-fill" style={{ width: `${toolingRate(f)}%` }} />
                    </div>
                    <span className="tooling-pct mono">{toolingRate(f)}%</span>
                  </div>
                  <div className="fw-card-foot">
                    <a className="btn btn-ghost btn-sm" href={`/t/${slug}/referentiels/${f.id}`}>
                      Ouvrir
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {available.length > 0 ? (
          <>
            <div className="section-rule">
              <span className="section-rule-label">Disponibles à l’activation ({available.length})</span>
            </div>
            <div className="catalog-grid catalog-grid--available">
              {available.map((f) => (
                <article className="card fw-card fw-card--available" key={f.id}>
                  <div className="fw-card-head">
                    <div>
                      <div className="fw-card-title">{f.name}</div>
                      <div className="fw-card-meta">
                        {(FRAMEWORK_SUBTITLE[f.code] ?? f.code.toUpperCase())} · {formatVersion(f.version)} ·{' '}
                        {f.requirementCount} exigences
                      </div>
                    </div>
                    <span className={`badge ${f.isBuiltin ? 'badge--builtin' : 'badge--custom'}`}>
                      {f.isBuiltin ? 'Intégré' : 'Interne'}
                    </span>
                  </div>
                  <div className="fw-card-foot">
                    {canManage ? (
                      <ActivateFrameworkButton slug={slug} frameworkId={f.id} scopes={scopes} />
                    ) : (
                      <a className="btn btn-ghost btn-sm" href={`/t/${slug}/referentiels/${f.id}`}>
                        Consulter
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {active.length > 0 ? (
          <div className="mut-band">
            <div className="mut-thread" aria-hidden="true">
              {activeCodes.map((code, i) => (
                <Fragment key={code}>
                  {i > 0 ? <span className="mut-thread-link" /> : null}
                  <span className="chip-ref">{code}</span>
                </Fragment>
              ))}
            </div>
            {mutualizedCount > 0 ? (
              <p>
                <b>
                  {mutualizedCount} contrôle{mutualizedCount > 1 ? 's' : ''} mutualisé
                  {mutualizedCount > 1 ? 's' : ''}
                </b>{' '}
                {mutualizedCount > 1 ? 'couvrent' : 'couvre'} 2 référentiels ou plus — prouvés une
                seule fois.
              </p>
            ) : (
              <p>
                Aucun contrôle mutualisé pour l’instant — rattachez un même contrôle à deux
                référentiels pour le prouver une seule fois.
              </p>
            )}
            {active[0] ? (
              <a className="mut-band-link" href={`/t/${slug}/referentiels/${active[0].id}`}>
                Voir le mapping →
              </a>
            ) : null}
          </div>
        ) : null}
      </main>
    </>
  );
}
