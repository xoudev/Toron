import { canManageControls, canRecordControlReview } from '@toron/core';
import { activeFrameworkCoverage, listAdoptedTemplateKeys, listControlLibrary, listTenantMembers, withTenant } from '@toron/db';
import { CONTROL_TEMPLATE_DOMAINS, controlTemplates } from '@toron/frameworks';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ControlLibrary } from './control-library';

export const dynamic = 'force-dynamic';

export default async function ControlesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);

  const today = todayParis();
  const { controls, members, coverage, adoptedKeys } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    controls: await listControlLibrary(tx, today),
    members: await listTenantMembers(tx),
    coverage: await activeFrameworkCoverage(tx),
    adoptedKeys: await listAdoptedTemplateKeys(tx),
  }));
  // Contrôles types : seuls l'intitulé, le domaine et les rattachements partent au navigateur.
  const templates = controlTemplates().map((t) => ({ key: t.key, domain: t.domain, title: t.title, mappings: t.mappings }));
  const overview = await getOrganisationOverview(ctx.tenantId);
  const active = controls.filter((c) => c.status === 'actif');
  const late = active.filter((c) => c.reviewState === 'en_retard').length;

  return (
    <>
      <Topbar
        crumbRoot="Pilotage"
        crumbCurrent="Contrôles internes"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{active.length} ACTIFS</span><ExportCsvLink slug={slug} registre="controles" /><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Contrôles internes</h1>
            <p className="sub">
              Les mesures qui couvrent vos exigences, et la preuve qu’elles fonctionnent : chaque contrôle a un
              responsable, une fréquence de revue et l’historique de ses revues d’efficacité. Un contrôle défaillant
              ouvre une action corrective.
            </p>
          </div>
        </div>
        {late > 0 ? (
          <div className="mut-band ctl-late" style={{ marginBottom: 16 }}>
            <p>
              <b>{late} contrôle{late > 1 ? 's' : ''} en retard de revue</b> : {late > 1 ? 'leur' : 'son'} efficacité n’est plus
              démontrée. Consignez une revue, ou ajustez la fréquence si elle n’est plus adaptée.
            </p>
          </div>
        ) : null}
        <ControlLibrary
          slug={slug}
          today={today}
          canManage={canManageControls(ctx.role)}
          canReview={canRecordControlReview(ctx.role)}
          exceptionsEnabled={overview.enabled('derogations')}
          controls={controls}
          members={members}
          templates={{ templates, domains: CONTROL_TEMPLATE_DOMAINS.map((d) => ({ key: d.key, label: d.label })), adoptedKeys, coverage }}
        />
      </main>
    </>
  );
}
