import { canConfigureOrganisation, canManageControls, nis2Qualification, obligationAttention, suggestedObligations } from '@toron/core';
import { listEntitiesNis2, listObligations, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ObligationBoard, type EntityView } from './obligation-board';

export const dynamic = 'force-dynamic';

export default async function ObligationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);

  const { entities, obligations, members } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    entities: await listEntitiesNis2(tx),
    obligations: await listObligations(tx),
    members: await listTenantMembers(tx),
  }));

  const today = todayParis();
  const entityViews: EntityView[] = entities.map((e) => {
    const qualification = nis2Qualification({ ...e, override: e.override });
    const present = new Set(obligations.filter((o) => o.entityId === e.id).map((o) => o.catalogKey));
    return { entity: e, qualification, missingSuggestions: suggestedObligations(qualification.status).filter((t) => !present.has(t.key)).length };
  });
  const open = obligations.filter((o) => o.status !== 'non_applicable');
  const late = obligations.filter((o) => obligationAttention(o.status, o.dueDate, today) === 'en_retard').length;

  return (
    <>
      <Topbar
        crumbRoot="Pilotage"
        crumbCurrent="Obligations"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{open.length} APPLICABLES</span><ExportCsvLink slug={slug} registre="obligations" /><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Obligations réglementaires</h1>
            <p className="sub">
              Ce qui s’impose à chaque entité — NIS 2, RGPD, exigences sectorielles et contractuelles — avec un
              responsable, un statut et une échéance. La qualification NIS 2 est indicative : l’enregistrement
              auprès de l’ANSSI fait foi.
            </p>
          </div>
        </div>
        <ObligationBoard
          slug={slug}
          today={today}
          canManage={canManageControls(ctx.role)}
          canConfigure={canConfigureOrganisation(ctx.role)}
          entities={entityViews}
          obligations={obligations}
          members={members}
          lateCount={late}
        />
      </main>
    </>
  );
}
