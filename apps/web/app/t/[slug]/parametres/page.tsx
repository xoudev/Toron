import { canConfigureOrganisation, canManageMembers, invitationState } from '@toron/core';
import {
  countAuditLog, exportedTableNames, getAuditChainHead, getOrganisationProfile, listAuditLog, listInvitations, listLegalEntities,
  listScopeDetails, listSites, listTenantMemberDetails, withTenant,
} from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ParametresClient } from './parametres-client';
import { parseSection } from './sections';

export const dynamic = 'force-dynamic';

const JOURNAL_PAGE_SIZE = 50;

export default async function ParametresPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);

  const section = parseSection(sp['section']);
  const filtre = typeof sp['filtre'] === 'string' ? sp['filtre'].slice(0, 40) : '';
  const page = Math.max(1, Number.parseInt(typeof sp['page'] === 'string' ? sp['page'] : '1', 10) || 1);

  const session = await auth().api.getSession({ headers: await headers() });
  const now = new Date();

  const data = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    profile: await getOrganisationProfile(tx),
    entities: await listLegalEntities(tx),
    sites: await listSites(tx),
    scopes: await listScopeDetails(tx),
    members: await listTenantMemberDetails(tx),
    invitations: await listInvitations(tx),
    audit: await listAuditLog(tx, { limit: JOURNAL_PAGE_SIZE, offset: (page - 1) * JOURNAL_PAGE_SIZE, actionPrefix: filtre || undefined }),
    auditTotal: await countAuditLog(tx, { actionPrefix: filtre || undefined }),
    chainHead: await getAuditChainHead(tx),
  }));

  const pendingInvitations = data.invitations.filter((i) => invitationState(i, now) === 'en_attente').length;

  return (
    <>
      <Topbar crumbRoot="Système" crumbCurrent="Paramètres" actions={<ThemeToggle />} />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Paramètres & administration</h1>
            <p className="sub">
              Organisation, périmètres, membres et sécurité de l’espace <b>{ctx.tenantName}</b> — et le
              journal d’audit immuable qui en trace chaque action.
            </p>
          </div>
        </div>
        <ParametresClient
          slug={slug}
          section={section}
          viewer={{
            userId: ctx.userId, role: ctx.role, twoFactorEnabled: Boolean(session?.user.twoFactorEnabled),
            canConfigure: canConfigureOrganisation(ctx.role), canManageMembers: canManageMembers(ctx.role),
          }}
          profile={data.profile}
          entities={data.entities}
          sites={data.sites}
          scopes={data.scopes}
          members={data.members}
          invitations={data.invitations}
          pendingInvitations={pendingInvitations}
          journal={{ rows: data.audit, total: data.auditTotal, page, pageSize: JOURNAL_PAGE_SIZE, filtre, head: data.chainHead }}
          exportTables={exportedTableNames()}
        />
      </main>
    </>
  );
}
