import { canManageControls } from '@toron/core';
import {
  getAssessmentItems,
  getFramework,
  getRequirementTree,
  listAssessments,
  listControlLinks,
  listControls,
  listExportsForObject,
  listScopes,
  withTenant,
  type AssessmentItemRow,
  type ExportSummary,
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
  searchParams,
}: {
  params: Promise<{ slug: string; frameworkId: string }>;
  searchParams: Promise<{ campaign?: string }>;
}) {
  const { slug, frameworkId } = await params;
  const { campaign } = await searchParams;
  if (!z.uuid().safeParse(frameworkId).success) notFound();
  const selectedCampaignId = campaign && z.uuid().safeParse(campaign).success ? campaign : null;

  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);

  const data = await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    const framework = await getFramework(tx, frameworkId);
    if (!framework) return null;
    const assessments = await listAssessments(tx, frameworkId);
    // La campagne active : celle demandée, sinon la plus récente en cours.
    const active =
      assessments.find((a) => a.id === selectedCampaignId) ??
      assessments.find((a) => a.status === 'en_cours') ??
      null;
    let items: AssessmentItemRow[] = [];
    let exportsList: ExportSummary[] = [];
    if (active) {
      items = await getAssessmentItems(tx, active.id);
      exportsList = await listExportsForObject(tx, active.id);
    }
    return {
      framework,
      tree: await getRequirementTree(tx, frameworkId),
      controls: await listControls(tx),
      links: await listControlLinks(tx, frameworkId),
      scopes: await listScopes(tx),
      assessments,
      activeCampaign: active,
      items,
      exportsList,
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
          scopes={data.scopes}
          framework={data.framework}
          tree={data.tree}
          controls={data.controls}
          links={data.links}
          assessments={data.assessments}
          activeCampaign={data.activeCampaign}
          items={data.items}
          exportsList={data.exportsList}
        />
      </main>
    </>
  );
}
