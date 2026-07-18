import { AppShell } from '@toron/ui';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getTenantContext } from '@/lib/tenant-context-cache';

import { TenantSidebar } from './tenant-sidebar';

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  direction: 'Direction',
  rssi: 'RSSI',
  resp_qualite: 'Responsable qualité',
  pilote: 'Pilote de processus',
  auditeur: 'Auditeur',
  contributeur: 'Contributeur',
  lecteur: 'Lecteur',
};

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

  // Chaque page fournit sa propre topbar (fil d'Ariane contextuel).
  return (
    <AppShell
      sidebar={
        <TenantSidebar
          slug={slug}
          tenantName={ctx.tenantName}
          tenantDetail="Périmètre SMSI + QMS"
          userName={ctx.userName}
          userRole={ROLE_LABELS[ctx.role] ?? ctx.role}
        />
      }
    >
      {children}
    </AppShell>
  );
}
