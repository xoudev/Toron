'use client';

import type { AuditRow, TenantMember } from '@toron/db';
import { useMemo, useState } from 'react';

import { initials } from '@/lib/format';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire', direction: 'Direction', rssi: 'RSSI', resp_qualite: 'Resp. qualité',
  pilote: 'Pilote', auditeur: 'Auditeur', contributeur: 'Contributeur', lecteur: 'Lecteur',
};
const ACTION_FILTERS: { label: string; prefix: string }[] = [
  { label: 'Tout', prefix: '' },
  { label: 'Risques', prefix: 'risk.' },
  { label: 'Actions', prefix: 'action.' },
  { label: 'Documents', prefix: 'document.' },
  { label: 'Preuves', prefix: 'evidence.' },
  { label: 'Incidents', prefix: 'incident.' },
  { label: 'Non-conformités', prefix: 'nc.' },
  { label: 'Contrôles', prefix: 'control.' },
  { label: 'Import', prefix: 'import.' },
];

function fmt(d: Date): string {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ParametresClient({ members, audit }: { members: TenantMember[]; audit: AuditRow[] }) {
  const [tab, setTab] = useState<'membres' | 'audit'>('membres');
  const [prefix, setPrefix] = useState('');
  const shown = useMemo(() => (prefix ? audit.filter((a) => a.action.startsWith(prefix)) : audit), [audit, prefix]);

  return (
    <>
      <div className="ds-toolbar">
        <div className="view-toggle" role="group" aria-label="Volet">
          <button aria-pressed={tab === 'membres'} onClick={() => setTab('membres')}>Membres ({members.length})</button>
          <button aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>Journal d’audit</button>
        </div>
        {tab === 'audit' ? (
          <>
            <span className="spacer" />
            <label className="field" style={{ margin: 0, minWidth: 170 }}>
              <select value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-label="Filtrer le journal">
                {ACTION_FILTERS.map((f) => <option key={f.prefix} value={f.prefix}>{f.label}</option>)}
              </select>
            </label>
          </>
        ) : null}
      </div>

      {tab === 'membres' ? (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 520 }}>
            <thead><tr><th>Membre</th><th>Rôle</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} style={{ cursor: 'default' }}>
                  <td><div className="ds-owner"><span className="ds-avatar">{initials(m.name)}</span><span className="ds-primary">{m.name}</span></div></td>
                  <td><span className="ds-chip">{ROLE_LABEL[m.role] ?? m.role}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 720 }}>
            <thead><tr><th style={{ width: 150 }}>Horodatage</th><th style={{ width: 150 }}>Acteur</th><th>Action</th><th style={{ width: 130 }}>Objet</th><th style={{ width: 120 }}>IP</th></tr></thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={5} className="ds-empty">Aucune entrée pour ce filtre.</td></tr>
              ) : shown.map((a) => (
                <tr key={a.id} style={{ cursor: 'default' }}>
                  <td className="ds-mono">{fmt(a.at)}</td>
                  <td>{a.actorName ?? '—'}</td>
                  <td><span className="ds-id">{a.action}</span></td>
                  <td className="ds-muted">{a.objectType}</td>
                  <td className="ds-mono">{a.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      <p className="risk-mut-hint" style={{ marginTop: 10 }}>Journal INSERT-only, sans aucune API d’effacement (S6) — 200 entrées les plus récentes.</p>
    </>
  );
}
