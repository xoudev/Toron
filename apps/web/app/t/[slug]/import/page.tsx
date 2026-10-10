import { canManageControls, defaultRiskScale } from '@toron/core';
import { getActiveScale, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ImportWizard } from './import-wizard';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  if (!canManageControls(ctx.role)) redirect(`/t/${slug}`);
  // Les cotations de risque importées sont validées contre l'échelle active
  // (celle par défaut tant qu'aucune n'est posée : l'import la pose à l'identique).
  const riskScaleSize =
    (await withTenant(appDb().db, ctx.tenantId, (tx) => getActiveScale(tx)))?.scale.size ?? defaultRiskScale().size;

  return (
    <>
      <Topbar crumbRoot="Système" crumbCurrent="Importer depuis Excel" actions={<ThemeToggle />} />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Importer depuis Excel</h1>
            <p className="sub">
              Assistant de migration en 4 étapes — chaque ligne rejetée porte sa cause et sa
              correction, jamais un « 12 erreurs » sans détail.
            </p>
          </div>
        </div>
        <ImportWizard slug={slug} riskScaleSize={riskScaleSize} />
      </main>
    </>
  );
}
