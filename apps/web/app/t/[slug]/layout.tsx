import { MEMBERSHIP_ROLE_LABEL } from '@toron/core';
import { AppShell } from '@toron/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
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
