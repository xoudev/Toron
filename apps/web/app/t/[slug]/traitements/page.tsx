import { OBLIGATION_STATUS_LABEL, canManageControls, processingGaps, processorAgreementState } from '@toron/core';
import { listEntitiesNis2, listObligations, listProcessing, listSuppliers, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { appDb } from '@/lib/db';
import { refCode, todayParis } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ProcessingBoard } from './processing-board';

export const dynamic = 'force-dynamic';

export default async function TraitementsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);

  const { items, suppliers, members, entities, obligation } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    items: await listProcessing(tx),
    suppliers: await listSuppliers(tx),
    members: await listTenantMembers(tx),
    entities: await listEntitiesNis2(tx),
    obligation: (await listObligations(tx)).find((o) => o.catalogKey === 'rgpd_registre') ?? null,
  }));

  const today = todayParis();
  const incomplete = items.filter((p) => processingGaps(p).length > 0).length;
  const uncovered = new Map<string, string>();
  for (const p of items) for (const x of p.processors) if (processorAgreementState(x, today) !== 'couvert') uncovered.set(x.supplierId, x.name);

  return (
    <>
      <Topbar
        crumbRoot="Pilotage"
        crumbCurrent="Traitements RGPD"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{items.length} TRAITEMENTS</span><ExportCsvLink slug={slug} registre="traitements" /><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Registre des traitements</h1>
            <p className="sub">
              Une fiche par activité de traitement, avec les rubriques de l’article 30 du RGPD. Les sous-traitants
              viennent du registre des fournisseurs : leur accord de traitement s’y enregistre une seule fois.
            </p>
          </div>
        </div>
        {incomplete > 0 || uncovered.size > 0 || obligation ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            {incomplete > 0 ? <p><b>{incomplete} fiche{incomplete > 1 ? 's' : ''} incomplète{incomplete > 1 ? 's' : ''}</b> au regard de l’article 30 — les rubriques manquantes sont indiquées dans chaque fiche.</p> : null}
            {uncovered.size > 0 ? (
              <p>
                <b>Sans accord de traitement valide :</b>{' '}
                {[...uncovered].map(([id, name], i) => <span key={id}>{i > 0 ? ', ' : ''}<a href={`/t/${slug}/fournisseurs?ouvrir=${id}`}>{name}</a></span>)}
                {' '}— ajoutez l’accord dans les attestations du fournisseur.
              </p>
            ) : null}
            {obligation ? (
              <p>Obligation liée : <a href={`/t/${slug}/obligations?ouvrir=${obligation.id}`}>{refCode('OBL', obligation.id)} · {obligation.title}</a> — {OBLIGATION_STATUS_LABEL[obligation.status]}.</p>
            ) : null}
          </div>
        ) : null}
        <ProcessingBoard
          slug={slug}
          today={today}
          canManage={canManageControls(ctx.role)}
          items={items}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
          members={members}
          entities={entities.map((e) => ({ id: e.id, name: e.name }))}
        />
      </main>
    </>
  );
}
