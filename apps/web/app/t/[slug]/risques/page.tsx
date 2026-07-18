import { canManageControls } from '@toron/core';
import {
  ensureDefaultScale,
  getActiveScale,
  listControls,
  listRisks,
  listScopes,
  listTenantMembers,
  withTenant,
} from '@toron/db';
import { BrandMark, ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { RiskRegister } from './risk-register';

export const dynamic = 'force-dynamic';

export default async function RisquesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { risks, scale, scopes, controls, members } = await withTenant(
    appDb().db,
    ctx.tenantId,
    async (tx) => {
      // Garantit une échelle active (4×4 par défaut au premier accès).
      const active = canManage ? await ensureDefaultScale(tx, ctx.tenantId) : await getActiveScale(tx);
      return {
        risks: await listRisks(tx),
        scale: active,
        scopes: await listScopes(tx),
        controls: await listControls(tx),
        members: await listTenantMembers(tx),
      };
    },
  );

  const scaleView = scale
    ? { size: scale.scale.size, gLabels: scale.scale.gLabels, vLabels: scale.scale.vLabels, bands: scale.scale.bands }
    : { size: 4, gLabels: [], vLabels: [], bands: [] };

  const attention = risks.filter(
    (r) => r.acceptanceState === 'en_attente' || r.acceptanceState === 'expiree',
  ).length;

  return (
    <>
      <Topbar
        crumbRoot="Risques"
        crumbCurrent="Registre des risques"
        actions={
          <>
            <span className="topbar-crumb" style={{ marginRight: 4 }}>
              {risks.length} RISQUE{risks.length > 1 ? 'S' : ''}
            </span>
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Registre des risques</h1>
            <p className="sub">
              Cotation brute et nette sur une matrice versionnée, options de traitement et
              acceptations formelles signées — chaque risque accepté porte son signataire.
            </p>
          </div>
        </div>

        {attention > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p>
              <b>
                {attention} risque{attention > 1 ? 's' : ''}
              </b>{' '}
              en acceptation à traiter — à remonter en revue de direction.
            </p>
          </div>
        ) : null}

        {risks.length === 0 && !canManage ? (
          <div className="empty-state">
            <span className="brand-ghost">
              <BrandMark size={34} />
            </span>
            <h2>Aucun risque enregistré</h2>
            <p>Le registre est vide pour l’instant.</p>
          </div>
        ) : (
          <RiskRegister
            slug={slug}
            canManage={canManage}
            scale={scaleView}
            risks={risks}
            scopes={scopes}
            controls={controls.map((c) => ({ id: c.id, title: c.title }))}
            members={members}
          />
        )}
      </main>
    </>
  );
}
