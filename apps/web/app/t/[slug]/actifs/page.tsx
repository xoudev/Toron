import { canManageControls } from '@toron/core';
import { listAssets, listRisks, listScopes, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { AssetInventory } from './asset-inventory';

export const dynamic = 'force-dynamic';

export default async function ActifsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { assets, scopes, risks } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    assets: await listAssets(tx),
    scopes: await listScopes(tx),
    risks: await listRisks(tx),
  }));

  const sensitive = assets.filter((a) => a.sensitivity >= 4).length;

  return (
    <>
      <Topbar
        crumbRoot="Risques"
        crumbCurrent="Cartographie des actifs"
        actions={
          <>
            <span className="topbar-crumb" style={{ marginRight: 4 }}>
              {assets.length} ACTIF{assets.length > 1 ? 'S' : ''}
            </span>
            <ThemeToggle />
          </>
        }
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Cartographie des actifs</h1>
            <p className="sub">
              Inventaire matériel, logiciel, données et flux, coté DICP. Import CSV comme porte
              d’entrée ; chaque actif se relie aux risques du registre.
            </p>
          </div>
        </div>

        {sensitive > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p>
              <b>{sensitive} actif{sensitive > 1 ? 's' : ''} critique{sensitive > 1 ? 's' : ''}</b> (sensibilité 4) — à couvrir en priorité par des contrôles et des risques traités.
            </p>
          </div>
        ) : null}

        <AssetInventory
          slug={slug}
          canManage={canManage}
          assets={assets}
          scopes={scopes}
          risks={risks.map((r) => ({ id: r.id, title: r.title }))}
        />
      </main>
    </>
  );
}
