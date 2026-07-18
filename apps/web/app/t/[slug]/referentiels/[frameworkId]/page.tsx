import { canManageControls } from '@toron/core';
import {
  getFramework,
  getRequirementTree,
  listControlLinks,
  listControls,
  withTenant,
} from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ReferentielDetail } from './detail';

export const dynamic = 'force-dynamic';

export default async function ReferentielDetailPage({
  params,
}: {
  params: Promise<{ slug: string; frameworkId: string }>;
}) {
  const { slug, frameworkId } = await params;
  if (!z.uuid().safeParse(frameworkId).success) notFound();

  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const data = await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    const framework = await getFramework(tx, frameworkId);
    if (!framework) return null;
    return {
      framework,
      tree: await getRequirementTree(tx, frameworkId),
      controls: await listControls(tx),
      links: await listControlLinks(tx, frameworkId),
    };
  });
  if (!data) notFound();

  return (
    <>
      <Topbar crumbRoot="Référentiels" crumbCurrent={data.framework.name} actions={<ThemeToggle />} />
      <main className="app-page">
        <ReferentielDetail
          slug={slug}
          canManage={canManage}
          framework={data.framework}
          tree={data.tree}
          controls={data.controls}
          links={data.links}
        />
      </main>
    </>
  );
}
