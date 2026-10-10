import { canManageControls, nis2Qualification, recyfEntityKindDefault } from '@toron/core';
import {
  getAssessmentItems,
  getFramework,
  getRequirementTree,
  listAssessments,
  listControlLinks,
  listControlLibrary,
  listControls,
  listEntitiesNis2,
  listExceptions,
  listExportsForObject,
  listScopes,
  withTenant,
  type AssessmentItemRow,
  type ExportSummary,
} from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ReferentielDetail } from './detail';

export const dynamic = 'force-dynamic';

/** Titre d'onglet : le nom du référentiel, pour distinguer plusieurs onglets ouverts. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string; frameworkId: string }> }): Promise<Metadata> {
  const { slug, frameworkId } = await params;
  const fallback: Metadata = { title: 'Référentiel — Toron' };
  if (!z.uuid().safeParse(frameworkId).success) return fallback;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') return fallback;
  const framework = await withTenant(appDb().db, ctx.tenantId, (tx) => getFramework(tx, frameworkId));
  return framework ? { title: `${framework.name} — Toron` } : fallback;
}

export default async function ReferentielDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; frameworkId: string }>;
  searchParams: Promise<{ campaign?: string; exigence?: string }>;
}) {
  const { slug, frameworkId } = await params;
  const { campaign, exigence } = await searchParams;
  if (!z.uuid().safeParse(frameworkId).success) notFound();
  const selectedCampaignId = campaign && z.uuid().safeParse(campaign).success ? campaign : null;
  // Exigence à ouvrir (lien de la recherche Ctrl+K) ; ignorée si elle n'appartient pas au référentiel.
  const initialReqId = exigence && z.uuid().safeParse(exigence).success ? exigence : null;

  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const canManage = canManageControls(ctx.role);
  const exceptionsOn = (await getOrganisationOverview(ctx.tenantId)).enabled('derogations');

  const data = await withTenant(appDb().db, ctx.tenantId, async (tx) => {
    const framework = await getFramework(tx, frameworkId);
    if (!framework) return null;
    const assessments = await listAssessments(tx, frameworkId);
    // La campagne active : celle demandée, sinon la plus récente en cours,
    // sinon la plus récente tout court (clôturée, consultable).
    const active =
      assessments.find((a) => a.id === selectedCampaignId) ??
      assessments.find((a) => a.status === 'en_cours') ??
      assessments[0] ??
      null;
    // ReCyF : catégorie d'entité proposée d'après la qualification NIS 2.
    const nis2Default =
      framework.code === 'recyf'
        ? recyfEntityKindDefault((await listEntitiesNis2(tx)).map((e) => nis2Qualification({ ...e, override: e.override }).status))
        : null;
    let items: AssessmentItemRow[] = [];
    let exportsList: ExportSummary[] = [];
    if (active) {
      items = await getAssessmentItems(tx, active.id);
      exportsList = await listExportsForObject(tx, active.id);
    }
    // Dérogations ouvertes sur un contrôle : l'écart à connaître avant de s'appuyer dessus.
    const controlExceptions = exceptionsOn
      ? (await listExceptions(tx, todayParis()))
          .filter((e) => e.controlId !== null && ['en_attente', 'a_venir', 'en_vigueur', 'a_echeance', 'echue'].includes(e.state))
          .map((e) => ({ id: e.id, controlId: e.controlId!, state: e.state, expiresOn: e.expiresOn }))
      : [];
    // Dernière revue d'efficacité de chaque contrôle : la preuve qu'il fonctionne.
    const controlReviews = (await listControlLibrary(tx, todayParis())).map((c) => ({
      controlId: c.id, lastReviewedOn: c.lastReviewedOn, lastResult: c.lastResult, reviewState: c.reviewState,
    }));
    return {
      framework,
      controlExceptions,
      controlReviews,
      tree: await getRequirementTree(tx, frameworkId),
      controls: await listControls(tx),
      links: await listControlLinks(tx, frameworkId),
      scopes: await listScopes(tx),
      assessments,
      activeCampaign: active,
      items,
      exportsList,
      nis2Default,
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
          initialReqId={initialReqId}
          scopes={data.scopes}
          framework={data.framework}
          tree={data.tree}
          controls={data.controls}
          links={data.links}
          assessments={data.assessments}
          activeCampaign={data.activeCampaign}
          items={data.items}
          exportsList={data.exportsList}
          controlExceptions={data.controlExceptions}
          controlReviews={data.controlReviews}
          nis2Default={data.nis2Default}
        />
      </main>
    </>
  );
}
