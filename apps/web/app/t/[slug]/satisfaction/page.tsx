import {
  SATISFACTION_WINDOW_MONTHS, addMonthsIso, canManageSatisfaction, formatSurveyScore as formatScore, monthlyComplaints,
} from '@toron/core';
import { getSatisfactionOverview, listComplaints, listCustomerSurveys, listEvidences, listTenantMembers, withTenant } from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { ModuleDisabled } from '@/components/module-disabled';
import { appDb } from '@/lib/db';
import { frDate, todayParis } from '@/lib/format';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { SatisfactionBoard } from './satisfaction-board';

export const dynamic = 'force-dynamic';

const TREND_WORD = { hausse: 'en hausse', baisse: 'en baisse', stable: 'stable' } as const;

export default async function SatisfactionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const overview = await getOrganisationOverview(ctx.tenantId);
  if (!overview.enabled('satisfaction')) return <ModuleDisabled slug={slug} module="satisfaction" role={ctx.role} />;

  const today = todayParis();
  const since = addMonthsIso(today, -SATISFACTION_WINDOW_MONTHS);
  const data = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    surveys: await listCustomerSurveys(tx),
    complaints: await listComplaints(tx, since),
    summary: await getSatisfactionOverview(tx, today),
    members: await listTenantMembers(tx),
    evidences: await listEvidences(tx),
  }));
  const { summary } = data;
  const months = monthlyComplaints(data.complaints.map((c) => c.openedOn), today);
  const nps = summary.lastNps;
  const csat = summary.lastCsat;
  const complaintsTone = summary.complaints > summary.complaintsPrevious ? 'kpi--warn' : summary.complaints > 0 ? '' : 'kpi--ok';

  return (
    <>
      <Topbar
        crumbRoot="Qualité"
        crumbCurrent="Satisfaction client"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{summary.surveys} ENQUÊTES SUR 12 MOIS</span><ExportCsvLink slug={slug} registre="satisfaction" /><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Satisfaction client</h1>
            <p className="sub">
              Les mesures de satisfaction — baromètres NPS, questionnaires CSAT — avec leur objectif et leur tendance, et
              les réclamations clients des douze derniers mois. Résultats agrégés uniquement : aucun client n’est nommé.
            </p>
          </div>
        </div>
        <div className="sat-kpis">
          <div className={`card kpi ${nps ? (nps.verdict === 'sous_objectif' ? 'kpi--warn' : 'kpi--ok') : ''}`}>
            <span className="kpi-label">Dernier NPS</span>
            <span className="kpi-value">{nps ? formatScore('nps', nps.score) : '—'}</span>
            <span className="kpi-sub">
              {nps
                ? [nps.target !== null ? `objectif ${formatScore('nps', nps.target)}` : null, nps.trend ? TREND_WORD[nps.trend] : null, frDate(nps.closedOn)].filter(Boolean).join(' · ')
                : 'aucune mesure NPS'}
            </span>
          </div>
          <div className={`card kpi ${csat ? (csat.verdict === 'sous_objectif' ? 'kpi--warn' : 'kpi--ok') : ''}`}>
            <span className="kpi-label">Dernier CSAT</span>
            <span className="kpi-value">{csat ? formatScore('csat', csat.score) : '—'}</span>
            <span className="kpi-sub">
              {csat
                ? [csat.target !== null ? `objectif ${formatScore('csat', csat.target)}` : null, csat.trend ? TREND_WORD[csat.trend] : null, frDate(csat.closedOn)].filter(Boolean).join(' · ')
                : 'aucune mesure CSAT'}
            </span>
          </div>
          <div className={`card kpi ${complaintsTone}`}>
            <span className="kpi-label">Réclamations sur douze mois</span>
            <span className="kpi-value">{summary.complaints}</span>
            <span className={`kpi-sub${summary.complaints > summary.complaintsPrevious ? ' kpi-sub--warn' : ''}`}>
              {summary.complaintsPrevious === summary.complaints
                ? `autant que les douze mois précédents`
                : `${summary.complaintsPrevious} sur les douze mois précédents`}
            </span>
          </div>
          <div className={`card kpi ${summary.belowTarget > 0 ? 'kpi--warn' : summary.surveys > 0 ? 'kpi--ok' : ''}`}>
            <span className="kpi-label">Enquêtes sous l’objectif</span>
            <span className="kpi-value">{summary.surveys === 0 ? '—' : `${summary.belowTarget}/${summary.surveys}`}</span>
            <span className={`kpi-sub${summary.surveys === 0 ? ' kpi-sub--warn' : ''}`}>{summary.surveys === 0 ? 'aucune enquête sur douze mois' : 'sur douze mois'}</span>
          </div>
        </div>
        <SatisfactionBoard
          slug={slug}
          today={today}
          userId={ctx.userId}
          canManage={canManageSatisfaction(ctx.role)}
          surveys={data.surveys}
          complaints={data.complaints}
          months={months}
          ncEnabled={overview.enabled('non_conformites')}
          members={data.members}
          evidences={data.evidences.filter((e) => e.supersededById === null).map((e) => ({ id: e.id, label: e.title }))}
        />
      </main>
    </>
  );
}
