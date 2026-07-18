'use client';

import { Sidebar } from '@toron/ui';
import { usePathname } from 'next/navigation';

import { buildNav } from './nav';

/**
 * Sidebar du tenant : l'item actif est déterminé côté client d'après le
 * chemin courant, pour que la navigation reflète la route sans que le
 * layout serveur ait à connaître le segment.
 */
export function TenantSidebar({
  slug,
  tenantName,
  tenantDetail,
  userName,
  userRole,
}: {
  slug: string;
  tenantName: string;
  tenantDetail: string;
  userName: string;
  userRole: string;
}) {
  const pathname = usePathname();
  return (
    <Sidebar
      tenantName={tenantName}
      tenantDetail={tenantDetail}
      groups={buildNav(slug, pathname)}
      userName={userName}
      userRole={userRole}
    />
  );
}
