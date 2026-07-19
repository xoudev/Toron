import { listAuditLog, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ParametresClient } from './parametres-client';

export const dynamic = 'force-dynamic';

export default async function ParametresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);

  const { members, audit } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    members: await listTenantMembers(tx),
    audit: await listAuditLog(tx, { limit: 200 }),
  }));

  return (
    <>
      <Topbar crumbRoot="Système" crumbCurrent="Paramètres" actions={<ThemeToggle />} />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Paramètres & administration</h1>
            <p className="sub">
              Membres de l’organisation et journal d’audit immuable — chaque action métier, connexion
              et export y est tracé, sans possibilité d’effacement.
            </p>
          </div>
        </div>
        <ParametresClient members={members} audit={audit} />
      </main>
    </>
  );
}
