import { canManageControls } from '@toron/core';
import { listSuppliers, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { SupplierBoard } from './supplier-board';

export const dynamic = 'force-dynamic';

export default async function FournisseursPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const { suppliers, members } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    suppliers: await listSuppliers(tx),
    members: await listTenantMembers(tx),
  }));

  const t1ToDo = suppliers.filter((s) => s.tier === 't1' && s.contractStatus !== 'conforme').length;

  return (
    <>
      <Topbar
        crumbRoot="Système de management"
        crumbCurrent="Fournisseurs"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{suppliers.length} TIERS</span><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Tiers & fournisseurs</h1>
            <p className="sub">
              Registre avec tiering, données confiées et clauses contractuelles. Vos fournisseurs
              critiques (T1) portent une part de votre conformité — l’effet cascade.
            </p>
          </div>
        </div>
        {t1ToDo > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            <p><b>{t1ToDo} fournisseur{t1ToDo > 1 ? 's' : ''} critique{t1ToDo > 1 ? 's' : ''}</b> sans clauses contractuelles conformes — à traiter en priorité.</p>
          </div>
        ) : null}
        <SupplierBoard slug={slug} canManage={canManage} suppliers={suppliers} members={members} />
      </main>
    </>
  );
}
