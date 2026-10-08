import { canManageContinuity, continuitySummary } from '@toron/core';
import {
  listAssets, listContinuityActivities, listContinuityExercises, listDocuments, listEvidences, listProcesses, listSuppliers, listTenantMembers, withTenant,
} from '@toron/db';
import { ThemeToggle, Topbar } from '@toron/ui';
import { redirect } from 'next/navigation';

import { ExportCsvLink } from '@/components/export-csv-link';
import { ModuleDisabled } from '@/components/module-disabled';
import { appDb } from '@/lib/db';
import { frDate, todayParis } from '@/lib/format';
import { getOrganisationOverview } from '@/lib/organisation-overview';
import { getTenantContext } from '@/lib/tenant-context-cache';

import { ContinuityBoard } from './continuity-board';

export const dynamic = 'force-dynamic';

export default async function ContinuitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);
  if (ctx.verdict !== 'autorise') redirect(`/t/${slug}`);
  const overview = await getOrganisationOverview(ctx.tenantId);
  if (!overview.enabled('continuite')) return <ModuleDisabled slug={slug} module="continuite" role={ctx.role} />;

  const today = todayParis();
  const data = await withTenant(appDb().db, ctx.tenantId, async (tx) => ({
    activities: await listContinuityActivities(tx, today),
    exercises: await listContinuityExercises(tx),
    members: await listTenantMembers(tx),
    processes: overview.enabled('processus') ? await listProcesses(tx) : null,
    documents: await listDocuments(tx),
    assets: overview.enabled('actifs') ? await listAssets(tx) : [],
    suppliers: overview.enabled('fournisseurs') ? await listSuppliers(tx) : null,
    evidences: await listEvidences(tx),
  }));
  const summary = continuitySummary(data.activities, today);
  const tested = data.activities.filter((a) => a.state !== 'non_teste').length;
  const partial = data.activities.filter((a) => a.state === 'partiel').length;
  const next = data.exercises.filter((e) => e.status === 'planifie' && e.scheduledOn >= today).sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn))[0];

  return (
    <>
      <Topbar
        crumbRoot="Risques"
        crumbCurrent="Continuité d’activité"
        actions={<><span className="topbar-crumb" style={{ marginRight: 4 }}>{summary.activities} ACTIVITÉS</span><ExportCsvLink slug={slug} registre="continuite" /><ThemeToggle /></>}
      />
      <main className="app-page">
        <div className="page-head">
          <div>
            <h1>Continuité d’activité</h1>
            <p className="sub">
              Le bilan d’impact des activités critiques — durée d’interruption admissible (DMIA), perte de données
              admissible (PDMA), mode dégradé, dépendances — et les exercices qui prouvent qu’on sait reprendre dans
              ces délais. Un objectif manqué ouvre des actions correctives.
            </p>
          </div>
        </div>
        {summary.objectiveMissed > 0 ? (
          <div className="mut-band bcp-band--danger" style={{ marginBottom: 16 }}>
            <p>
              <b>{summary.objectiveMissed > 1 ? `${summary.objectiveMissed} activités n’ont pas tenu leur objectif de reprise` : '1 activité n’a pas tenu son objectif de reprise'}</b> au
              dernier exercice : traitez les enseignements, puis testez à nouveau.
            </p>
          </div>
        ) : null}
        {summary.biaDue > 0 ? (
          <div className="mut-band bcp-band--warn" style={{ marginBottom: 16 }}>
            <p>
              <b>{summary.biaDue > 1 ? `${summary.biaDue} bilans d’impact à revoir` : '1 bilan d’impact à revoir'}</b> : plus d’un an sans révision.
              Les activités, leurs délais et leurs dépendances ont pu changer.
            </p>
          </div>
        ) : null}
        <div className="bcp-kpis">
          <div className="card kpi">
            <span className="kpi-label">Activités critiques</span>
            <span className="kpi-value">{summary.activities}</span>
            <span className="kpi-sub">{summary.vital > 0 ? `dont ${summary.vital} vitale${summary.vital > 1 ? 's' : ''}` : 'aucune vitale'}</span>
          </div>
          <div className={`card kpi ${summary.criticalUntested > 0 ? 'kpi--warn' : summary.activities > 0 ? 'kpi--ok' : ''}`}>
            <span className="kpi-label">Testées sur douze mois</span>
            <span className="kpi-value">{summary.activities === 0 ? '—' : `${tested}/${summary.activities}`}</span>
            <span className={`kpi-sub${summary.criticalUntested > 0 ? ' kpi-sub--warn' : ''}`}>
              {summary.criticalUntested > 0
                ? `${summary.criticalUntested} forte${summary.criticalUntested > 1 ? 's' : ''} ou vitale${summary.criticalUntested > 1 ? 's' : ''} sans exercice`
                : 'activités fortes et vitales testées'}
            </span>
          </div>
          <div className={`card kpi ${summary.objectiveMissed > 0 ? 'kpi--danger' : partial > 0 ? 'kpi--warn' : tested > 0 ? 'kpi--ok' : ''}`}>
            <span className="kpi-label">Objectifs de reprise manqués</span>
            <span className="kpi-value">{tested === 0 ? '—' : summary.objectiveMissed}</span>
            <span className={`kpi-sub${summary.objectiveMissed > 0 ? ' alert' : partial > 0 ? ' kpi-sub--warn' : ''}`}>
              {partial > 0
                ? `${partial} test${partial > 1 ? 's' : ''} partiel${partial > 1 ? 's' : ''} à consolider`
                : 'au dernier exercice de chaque activité'}
            </span>
          </div>
          <div className={`card kpi ${next ? '' : 'kpi--warn'}`}>
            <span className="kpi-label">Prochain exercice</span>
            <span className="kpi-value">{next ? frDate(next.scheduledOn) : '—'}</span>
            <span className={`kpi-sub${next ? '' : ' kpi-sub--warn'}`}>{next ? next.title : 'aucun exercice planifié'}</span>
          </div>
        </div>
        <ContinuityBoard
          slug={slug}
          today={today}
          userId={ctx.userId}
          canManage={canManageContinuity(ctx.role)}
          activities={data.activities}
          exercises={data.exercises}
          members={data.members}
          processes={data.processes && data.processes.map((p) => ({ id: p.id, label: p.name }))}
          documents={data.documents.map((d) => ({ id: d.id, label: d.title }))}
          assets={data.assets.map((a) => ({ id: a.id, label: a.name }))}
          suppliers={data.suppliers && data.suppliers.map((s) => ({ id: s.id, label: s.name }))}
          evidences={data.evidences.filter((e) => e.supersededById === null).map((e) => ({ id: e.id, label: e.title }))}
        />
      </main>
    </>
  );
}
