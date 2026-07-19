import { canManageControls } from '@toron/core';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { getTenantContext } from '@/lib/tenant-context-cache';

import { ImportWizard } from './import-wizard';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  if (!canManageControls(ctx.role)) redirect(`/t/${slug}`);

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
        <ImportWizard slug={slug} />
      </main>
    </>
  );
}
