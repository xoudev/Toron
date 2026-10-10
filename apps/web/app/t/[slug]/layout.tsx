import { MEMBERSHIP_ROLE_LABEL, urgentWorkCount, workKindEnabled } from '@toron/core';
import { countUnreadNotifications, listMyWork, withTenant } from '@toron/db';
import { AppShell, BrandMark, NotificationsProvider } from '@toron/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { NotificationCenter } from '@/components/notification-center';
import { SearchPalette } from '@/components/search-palette';
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
  // Refus : la page rend le message, sans chrome de shell.
  if (ctx.verdict === 'refuse') return <>{children}</>;
  // TOTP requis : même carte sur toutes les pages de l'organisation, avec la
  // raison et les issues possibles (activer, changer d'organisation, sortir).
  if (ctx.verdict === 'totp_requis') {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
          <h1>{ctx.tenantName}</h1>
          <p>
            Votre rôle exige la double authentification. Le propriétaire, la direction et le RSSI
            détiennent des droits étendus : un mot de passe seul ne suffit pas. L’activation prend
            deux minutes avec une application d’authentification.
          </p>
          <a className="btn btn-primary" href={`/securite/2fa?suite=${encodeURIComponent(`/t/${slug}`)}`}>
            Activer la double authentification
          </a>
          <div className="auth-actions">
            <a className="btn btn-ghost btn-sm" href="/organisations?choisir=1">Changer d’organisation</a>
            <SignOutButton className="btn btn-ghost btn-sm" />
          </div>
        </div>
      </main>
    );
  }

  const overview = await getOrganisationOverview(ctx.tenantId);
  const { myWork, unread } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    myWork: await listMyWork(tx, ctx.userId),
    unread: await countUnreadNotifications(tx, ctx.userId),
  }));

  // Chaque page fournit sa propre topbar (fil d'Ariane contextuel).
  return (
    <NotificationsProvider initialUnread={unread}>
      <AppShell
        sidebar={
          <TenantSidebar
            slug={slug}
            tenantName={ctx.tenantName}
            tenantDetail={overview.headline}
            userName={ctx.userName}
            userRole={MEMBERSHIP_ROLE_LABEL[ctx.role]}
            urgentWork={urgentWorkCount(myWork.filter((i) => workKindEnabled(i.kind, overview.disabledModules)), todayParis())}
            disabledModules={overview.disabledModules}
            footerActions={
              <>
                <a className="sidebar-link" href="/organisations?choisir=1">Changer d’organisation</a>
                <SignOutButton />
              </>
            }
          />
        }
      >
        {children}
        <SearchPalette slug={slug} />
        <NotificationCenter slug={slug} />
      </AppShell>
    </NotificationsProvider>
  );
}
