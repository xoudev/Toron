import { awarenessSummary, canManageTraining, ownersStandInForLeaders } from '@toron/core';
import { listEvidences, listLeaderTraining, listTenantMembers, listTrainingSessions, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { ModuleDisabled } from '@/components/module-disabled';
import { appDb } from '@/lib/db';
import { todayParis } from '@/lib/format';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { TrainingBoard } from './training-board';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sensibilisation et formation — Toron' };

export default async function SensibilisationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const overview = await getOrganisationOverview(ctx.tenantId);
  if (!overview.enabled('sensibilisation')) return <ModuleDisabled slug={slug} module="sensibilisation" role={ctx.role} />;

  const today = todayParis();
  const { sessions, leaders, members, evidences } = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    sessions: await listTrainingSessions(tx, today),
    leaders: await listLeaderTraining(tx, today),
    members: await listTenantMembers(tx),
    evidences: await listEvidences(tx),
  }));
  const summary = awarenessSummary(sessions, today);
  const untrained = leaders.filter((l) => l.state === 'a_renouveler' || l.state === 'jamais');
  const ownersOnly = ownersStandInForLeaders(leaders.map((l) => l.role));
  const employees = overview.profile.employeeCount;
  const sheetsOnFile = summary.held - summary.withoutSheet;

  return (
    <>
      <Topbar
        crumbRoot="Système de management"
        crumbCurrent="Sensibilisation et formation"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{summary.upcoming} À VENIR</span><ExportCsvLink slug={slug} registre="sensibilisation" /><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Sensibilisation et formation</h1>
            <p className="sub">
              Les sessions de sensibilisation et de formation, leur public, leur participation et la feuille d’émargement
              au coffre de preuves. Les salariés sont comptés, pas nommés ; seuls les membres de l’organisation dans
              Toron, dont les dirigeants, apparaissent nommément.
            </p>
          </div>
        </div>
        {untrained.length > 0 && ownersOnly ? (
          <div className="mut-band trn-band--warn" style={{ marginBottom: 16 }}>
            <p>
              <b>Aucun membre n’a le rôle Direction</b> : pour la formation des dirigeants (NIS 2, art. 20), Toron suit à défaut{' '}
              {untrained.length > 1 ? `${untrained.length} propriétaires de l’organisation` : `le propriétaire de l’organisation, ${untrained[0]!.name},`} sans
              formation à jour. Invitez votre direction avec le rôle Direction dans{' '}
              <a href={`/t/${slug}/parametres?section=membres`}>Paramètres › Utilisateurs &amp; rôles</a> : c’est elle qui sera alors suivie.
            </p>
          </div>
        ) : untrained.length > 0 ? (
          <div className="mut-band trn-band--danger" style={{ marginBottom: 16 }}>
            <p>
              <b>{untrained.length > 1 ? `${untrained.length} dirigeants n’ont pas de formation à jour` : `${untrained[0]!.name} n’a pas de formation à jour`}</b> :
              NIS 2 (art. 20) impose aux membres des organes de direction de suivre une formation à la cybersécurité.
              Planifiez une session « Formation des dirigeants ».
            </p>
          </div>
        ) : null}
        <div className="trn-kpis">
          <div className="card kpi">
            <span className="kpi-label">Sessions tenues</span>
            <span className="kpi-value">{summary.held}</span>
            <span className="kpi-sub">sur douze mois glissants</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">Participations</span>
            <span className="kpi-value">{summary.participations}</span>
            <span className="kpi-sub">{employees ? `pour un effectif de ${employees} salariés` : 'une personne peut compter plusieurs fois'}</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">Taux de présence</span>
            <span className="kpi-value">{summary.attendanceRate === null ? '—' : `${summary.attendanceRate}%`}</span>
            <span className="kpi-sub">présents rapportés aux attendus</span>
          </div>
          <div className={`card kpi ${summary.withoutSheet > 0 ? 'kpi--warn' : summary.held > 0 ? 'kpi--ok' : ''}`}>
            <span className="kpi-label">Feuilles d’émargement</span>
            <span className="kpi-value">{summary.held === 0 ? '—' : `${sheetsOnFile}/${summary.held}`}</span>
            <span className={`kpi-sub${summary.withoutSheet > 0 ? ' kpi-sub--warn' : ''}`}>
              {summary.withoutSheet > 0
                ? `${summary.withoutSheet} à déposer au coffre de preuves`
                : summary.held > 0 ? 'toutes au coffre de preuves' : 'aucune session tenue sur douze mois'}
            </span>
          </div>
        </div>
        <TrainingBoard
          slug={slug}
          today={today}
          userId={ctx.userId}
          canManage={canManageTraining(ctx.role)}
          sessions={sessions}
          leaders={leaders}
          members={members}
          evidences={evidences.filter((e) => e.supersededById === null).map((e) => ({ id: e.id, label: e.title }))}
        />
      </main>
    </>
  );
}
