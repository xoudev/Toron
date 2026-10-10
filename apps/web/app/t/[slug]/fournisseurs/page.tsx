import { attestationFreshness, canManageControls, supplierAssessmentState, supplierNeedsAttention } from '@toron/core';
import { listSuppliers, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { ModuleDisabled } from '@/components/module-disabled';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { SupplierBoard } from './supplier-board';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Tiers & fournisseurs — Toron' };

export default async function FournisseursPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  if (!(await getOrganisationOverview(ctx.tenantId)).enabled('fournisseurs')) return <ModuleDisabled slug={slug} module="fournisseurs" role={ctx.role} />;
  const canManage = canManageControls(ctx.role);

  const { suppliers, members } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    suppliers: await listSuppliers(tx),
    members: await listTenantMembers(tx),
  }));

  const today = todayParis();
  const t1ToDo = suppliers.filter((s) => s.tier === 't1' && s.contractStatus !== 'conforme').length;
  const watch = suppliers.filter((s) => supplierNeedsAttention(s.tier, {
    assessment: supplierAssessmentState(s.tier, s.lastAssessedOn, today),
    insufficient: s.lastRating === 'insuffisant',
    expiredAttestation: s.attestationCount > 0 && attestationFreshness(s.nextAttestationExpiry, today) === 'expiree',
  }));
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

  return (
    <>
      <Topbar
        crumbRoot="Système de management"
        crumbCurrent="Fournisseurs"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{suppliers.length} TIERS</span><ExportCsvLink slug={slug} registre="fournisseurs" />
            <ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Tiers & fournisseurs</h1>
            <p className="sub">
              Registre avec tiering, évaluation, attestations et clauses contractuelles. Vos
              fournisseurs critiques (T1) portent une part de votre conformité — l’effet cascade.
            </p>
          </div>
        </div>
        {t1ToDo > 0 || watch.length > 0 ? (
          <div className="mut-band" style={{ marginBottom: 16 }}>
            {t1ToDo > 0 ? <p><b>{plural(t1ToDo, 'fournisseur')} critique{t1ToDo > 1 ? 's' : ''}</b> sans clauses contractuelles conformes — à traiter en priorité.</p> : null}
            {watch.length > 0 ? (
              <p>
                <b>{plural(watch.length, 'fournisseur')} à suivre</b> — évaluation insuffisante ou à refaire, ou attestation expirée :{' '}
                {watch.map((s, i) => <span key={s.id}>{i > 0 ? ', ' : ''}<a href={`/t/${slug}/fournisseurs?ouvrir=${s.id}`}>{s.name}</a></span>)}.
              </p>
            ) : null}
          </div>
        ) : null}
        <SupplierBoard slug={slug} canManage={canManage} suppliers={suppliers} members={members} today={today} />
      </main>
    </>
  );
}
