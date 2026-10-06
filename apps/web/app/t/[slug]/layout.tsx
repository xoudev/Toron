import { MEMBERSHIP_ROLE_LABEL, urgentWorkCount } from '@toron/core';
import { listMyWork, withTenant } from '@toron/db';
import { AppShell } from '@toron/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { TenantSidebar } from './tenant-sidebar';

export const dynamic = 'force-dynamic';

export default async function TenantLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: ReactNode;
}) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);

  if (ctx.verdict === 'non_connecte') redirect('/connexion');
  // Refus et TOTP requis : la page rend le message, sans chrome de shell.
  if (ctx.verdict !== 'autorise') return <>{children}</>;

  const overview = await getOrganisationOverview(ctx.tenantId);
  const myWork = await withTenant(appDb().db, ctx.tenantId, (tx) => listMyWork(tx, ctx.userId));

  // Chaque page fournit sa propre topbar (fil d'Ariane contextuel).
  return (
    <AppShell
      sidebar={
        <TenantSidebar
          slug={slug}
          tenantName={ctx.tenantName}
          tenantDetail={overview.headline}
          userName={ctx.userName}
          userRole={MEMBERSHIP_ROLE_LABEL[ctx.role]}
          urgentWork={urgentWorkCount(myWork, todayParis())}
          footerActions={
            <>
              <a className="sidebar-link" href="/organisations">Changer d’organisation</a>
              <SignOutButton />
            </>
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
