'use client';

import type { RiskBand } from '@toron/core';
import type { RiskSummary, ScopeSummary, TenantMember } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';

import {
  acceptRiskAction,
  createRiskAction,
  getRiskControlsAction,
  rateRiskAction,
  saveRiskDetailsAction,
  toggleRiskControlAction,
} from './risk-actions';

interface ScaleView {
  size: number;
  gLabels: string[];
  vLabels: string[];
  bands: RiskBand[][];
}
type ControlLite = { id: string; title: string };

const BAND_LABEL: Record<RiskBand, string> = {
  faible: 'Faible',
  moyen: 'Moyen',
  eleve: 'Élevé',
  critique: 'Critique',
};
const TREATMENT_LABEL: Record<string, string> = {
  reduire: 'Réduire',
  transferer: 'Transférer',
  accepter: 'Accepter',
  eviter: 'Éviter',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

function Level({ band, gv, target = false }: { band: RiskBand | null; gv?: string; target?: boolean }) {
  if (!band) return <span className="ds-mono">—</span>;
  return (
    <span className={`ds-level${target ? ' dim' : ''}`}>
      <span className={`ds-level-swatch sw--${band}${target ? ' target' : ''}`} />
      <b>{gv ?? BAND_LABEL[band]}</b>
    </span>
  );
}

export function RiskRegister({
  slug,
  canManage,
  scale,
  risks,
  scopes,
  controls,
  members,
}: {
  slug: string;
  canManage: boolean;
  scale: ScaleView;
  risks: RiskSummary[];
  scopes: ScopeSummary[];
  controls: ControlLite[];
  members: TenantMember[];
}) {
  const [filter, setFilter] = useState<{ g: number; v: number } | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const bandOf = (g: number, v: number): RiskBand | null =>
    g >= 1 && v >= 1 && g <= scale.size && v <= scale.size ? scale.bands[g - 1]?.[v - 1] ?? null : null;
  const cellCount = (g: number, v: number): number =>
    risks.filter((r) => r.netG === g && r.netV === v).length;

  const shown = useMemo(() => {
    let list = risks;
    if (filter) list = list.filter((r) => r.netG === filter.g && r.netV === filter.v);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          refCode('RSK', r.id).toLowerCase().includes(q) ||
          (r.businessValue ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [risks, filter, query]);

  const levels = Array.from({ length: scale.size }, (_, i) => i + 1);
  const open = openId ? risks.find((r) => r.id === openId) ?? null : null;

  return (
    <>
      <div className="ds-toolbar">
        <div className="ds-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M16.5 16.5 20.5 20.5" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher — RSK-023, actif, scénario" />
        </div>
        <div className="ds-legend">
          {(['faible', 'moyen', 'eleve', 'critique'] as RiskBand[]).map((b) => (
            <span className="ds-legend-item" key={b}>
              <span className={`ds-legend-swatch sw--${b}`} />
              {BAND_LABEL[b]}
            </span>
          ))}
        </div>
        <span className="spacer" />
        {canManage ? (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Ajouter un risque</button>
        ) : null}
      </div>

      {/* Matrice filtrante */}
      <div className="card" style={{ padding: 15, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span className="drawer-section-label" style={{ margin: 0 }}>Matrice · cotation nette (G × V)</span>
          {filter ? (
            <button className="ds-chip accent" onClick={() => setFilter(null)}>Filtre G{filter.g}×V{filter.v} — réinitialiser</button>
          ) : (
            <span className="ds-mono" style={{ marginLeft: 'auto' }}>CLIQUEZ UNE CASE POUR FILTRER</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="matrix-axis-y">GRAVITÉ</div>
          <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
            <div className="risk-matrix" style={{ gridTemplateColumns: `20px repeat(${scale.size}, minmax(52px,1fr))`, minWidth: 300 }}>
              {levels.slice().reverse().map((g) => (
                <RowFragment key={g} g={g} levels={levels} bandOf={bandOf} cellCount={cellCount} gLabel={scale.gLabels[g - 1] ?? String(g)} vLabels={scale.vLabels} filter={filter} onPick={(gg, vv) => setFilter((f) => (f && f.g === gg && f.v === vv ? null : { g: gg, v: vv }))} />
              ))}
              <span className="matrix-corner">G/V</span>
              {levels.map((v) => (
                <span className="matrix-corner" key={v} style={{ textAlign: 'center' }} title={scale.vLabels[v - 1]}>{v}</span>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: 8, paddingLeft: 22 }} className="ds-mono">VRAISEMBLANCE</div>
          </div>
        </div>
      </div>

      {/* Table dense */}
      <div className="ds-table-card">
        <div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th style={{ width: 74 }}>ID</th>
                <th style={{ minWidth: 240 }}>Risque</th>
                <th style={{ width: 160 }}>Valeur métier</th>
                <th style={{ width: 96 }}>Brut</th>
                <th style={{ width: 118 }}>Traitement</th>
                <th style={{ width: 96 }}>Net</th>
                <th style={{ width: 92 }}>Cible</th>
                <th style={{ width: 150 }}>Propriétaire</th>
                <th style={{ width: 92 }}>Revue</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={9} className="ds-empty">{filter || query ? 'Aucun risque ne correspond.' : 'Aucun risque enregistré.'}</td></tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} onClick={() => setOpenId(r.id)}>
                    <td className="ds-id">{refCode('RSK', r.id)}</td>
                    <td>
                      <div className="ds-primary">{r.title}</div>
                      {r.acceptanceState === 'acceptee' ? (
                        <span className="ds-accept-badge">ACCEPTÉ{r.acceptanceExpiresAt ? ` · ${fmtDate(r.acceptanceExpiresAt)}` : ''}</span>
                      ) : r.acceptanceState === 'en_attente' ? (
                        <span className="ds-accept-badge pending">ACCEPTATION EN ATTENTE</span>
                      ) : r.acceptanceState === 'expiree' ? (
                        <span className="ds-accept-badge pending">REVALIDATION REQUISE</span>
                      ) : null}
                    </td>
                    <td className="ds-muted">{r.businessValue ?? '—'}</td>
                    <td><Level band={r.grossBand} gv={`${r.grossG}×${r.grossV}`} /></td>
                    <td><span className="ds-chip">{TREATMENT_LABEL[r.treatment] ?? r.treatment}</span></td>
                    <td><Level band={r.netBand} gv={`${r.netG}×${r.netV}`} /></td>
                    <td>{r.residualTarget ? <Level band={r.residualTarget} gv={BAND_LABEL[r.residualTarget]} target /> : <span className="ds-mono">—</span>}</td>
                    <td>
                      <div className="ds-owner">
                        <span className="ds-avatar" title={r.ownerName ?? undefined}>{initials(r.ownerName)}</span>
                        <span>{r.ownerName ?? '—'}</span>
                      </div>
                    </td>
                    <td className="ds-mono">{fmtDate(r.nextReview)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canManage && creating ? (
        <RiskCreateDialog slug={slug} scale={scale} scopes={scopes} members={members} bandOf={bandOf} onClose={() => setCreating(false)} />
      ) : null}
      {open ? (
        <RiskDrawer slug={slug} scale={scale} members={members} controls={controls} bandOf={bandOf} risk={open} canManage={canManage} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

function RowFragment({
  g, levels, bandOf, cellCount, gLabel, filter, onPick,
}: {
  g: number; levels: number[]; bandOf: (g: number, v: number) => RiskBand | null; cellCount: (g: number, v: number) => number; gLabel: string; vLabels: string[]; filter: { g: number; v: number } | null; onPick: (g: number, v: number) => void;
}) {
  return (
    <>
      <span className="matrix-corner" style={{ alignSelf: 'center', textAlign: 'center' }} title={gLabel}>{g}</span>
      {levels.map((v) => {
        const band = bandOf(g, v);
        const count = cellCount(g, v);
        const pressed = filter?.g === g && filter?.v === v;
        return (
          <button key={v} type="button" className={`matrix-cell band--${band ?? 'faible'}${count === 0 ? ' matrix-cell--empty' : ''}`} aria-pressed={pressed} title={`Gravité ${g} × Vraisemblance ${v} — ${count} risque${count > 1 ? 's' : ''}`} onClick={() => (count > 0 || pressed ? onPick(g, v) : undefined)}>
            {count > 0 ? count : ''}
          </button>
        );
      })}
    </>
  );
}

// ── Tiroir de détail d'un risque ────────────────────────────────────────
function RiskDrawer({
  slug, scale, members, controls, bandOf, risk, canManage, onClose,
}: {
  slug: string; scale: ScaleView; members: TenantMember[]; controls: ControlLite[]; bandOf: (g: number, v: number) => RiskBand | null; risk: RiskSummary; canManage: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const levels = Array.from({ length: scale.size }, (_, i) => i + 1);
  const [gg, setGg] = useState(risk.grossG);
  const [gv, setGv] = useState(risk.grossV);
  const [ng, setNg] = useState(risk.netG);
  const [nv, setNv] = useState(risk.netV);

  function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setError(res.error?.message ?? 'Action refusée.');
    });
  }

  function saveDetails(fd: FormData) {
    run(() => saveRiskDetailsAction(slug, {
      riskId: risk.id,
      title: String(fd.get('title') ?? ''),
      scopeId: risk.scopeId,
      scenario: String(fd.get('scenario') ?? '') || null,
      businessValue: String(fd.get('businessValue') ?? '') || null,
      treatment: String(fd.get('treatment') ?? 'reduire'),
      residualTarget: String(fd.get('residualTarget') ?? '') || null,
      ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
      nextReview: String(fd.get('nextReview') ?? '') || null,
    }));
  }

  const LevelSelect = ({ value, onChange, name, labels }: { value: number; onChange: (n: number) => void; name: string; labels: string[] }) => (
    <label className="field" style={{ minWidth: 88 }}>{name}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={!canManage}>
        {levels.map((l) => <option key={l} value={l} title={labels[l - 1]}>{l}</option>)}
      </select>
    </label>
  );

  const header = (
    <>
      <span className="ds-id" id="risk-drawer-title">{refCode('RSK', risk.id)}</span>
      <span className="ds-level"><span className={`ds-level-swatch sw--${risk.netBand ?? 'faible'}`} /><b>{risk.netBand ? BAND_LABEL[risk.netBand] : '—'} · net</b></span>
      <span className="ds-chip">{risk.scopeName}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="risk-drawer-title" onClose={onClose}>
      <form action={saveDetails}>
        <div className="drawer-section">
          <label className="field">Intitulé
            <input name="title" defaultValue={risk.title} minLength={2} required disabled={!canManage} />
          </label>
          <label className="field">Scénario
            <textarea name="scenario" defaultValue={risk.scenario ?? ''} rows={2} disabled={!canManage} />
          </label>
          <label className="field">Valeur métier menacée
            <input name="businessValue" defaultValue={risk.businessValue ?? ''} disabled={!canManage} />
          </label>
          <div className="risk-form-grid">
            <label className="field">Traitement
              <select name="treatment" defaultValue={risk.treatment} disabled={!canManage}>
                {Object.entries(TREATMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="field">Propriétaire
              <select name="ownerUserId" defaultValue={risk.ownerUserId ?? ''} disabled={!canManage}>
                <option value="">— Non attribué —</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </select>
            </label>
            <label className="field">Niveau résiduel visé
              <select name="residualTarget" defaultValue={risk.residualTarget ?? ''} disabled={!canManage}>
                <option value="">—</option>
                {(Object.keys(BAND_LABEL) as RiskBand[]).map((b) => <option key={b} value={b}>{BAND_LABEL[b]}</option>)}
              </select>
            </label>
            <label className="field">Prochaine revue
              <input type="date" name="nextReview" defaultValue={risk.nextReview?.slice(0, 10) ?? ''} disabled={!canManage} />
            </label>
          </div>
          {canManage ? (
            <button type="submit" className="btn btn-ghost btn-sm" disabled={pending} style={{ marginTop: 8 }}>{pending ? 'Enregistrement…' : 'Enregistrer les détails'}</button>
          ) : null}
        </div>
      </form>

      <div className="drawer-section">
        <p className="drawer-section-label">Cotation</p>
        <div className="rating-row">
          <div className="rating-pair">
            <LevelSelect value={gg} onChange={setGg} name="G brute" labels={scale.gLabels} />
            <LevelSelect value={gv} onChange={setGv} name="V brute" labels={scale.vLabels} />
          </div>
          <div className="rating-preview"><Level band={bandOf(gg, gv)} gv={`${gg}×${gv}`} /></div>
        </div>
        <div className="rating-row" style={{ marginTop: 10 }}>
          <div className="rating-pair">
            <LevelSelect value={ng} onChange={setNg} name="G nette" labels={scale.gLabels} />
            <LevelSelect value={nv} onChange={setNv} name="V nette" labels={scale.vLabels} />
          </div>
          <div className="rating-preview"><Level band={bandOf(ng, nv)} gv={`${ng}×${nv}`} /></div>
          {canManage ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => rateRiskAction(slug, { riskId: risk.id, grossG: gg, grossV: gv, netG: ng, netV: nv }))}>Recoter</button>
          ) : null}
        </div>
      </div>

      <AcceptanceSection slug={slug} risk={risk} canManage={canManage} onDone={() => router.refresh()} />
      <ControlLinks slug={slug} riskId={risk.id} controls={controls} canManage={canManage} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </Drawer>
  );
}

function RiskCreateDialog({
  slug, scale, scopes, members, bandOf, onClose,
}: {
  slug: string; scale: ScaleView; scopes: ScopeSummary[]; members: TenantMember[]; bandOf: (g: number, v: number) => RiskBand | null; onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const levels = Array.from({ length: scale.size }, (_, i) => i + 1);
  const [gg, setGg] = useState(3);
  const [gv, setGv] = useState(3);
  const [ng, setNg] = useState(2);
  const [nv, setNv] = useState(2);

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createRiskAction(slug, {
        title: String(fd.get('title') ?? ''),
        scopeId: String(fd.get('scopeId') ?? ''),
        scenario: String(fd.get('scenario') ?? '') || null,
        businessValue: String(fd.get('businessValue') ?? '') || null,
        treatment: String(fd.get('treatment') ?? 'reduire'),
        residualTarget: String(fd.get('residualTarget') ?? '') || null,
        ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
        nextReview: String(fd.get('nextReview') ?? '') || null,
        grossG: gg, grossV: gv, netG: ng, netV: nv,
      });
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message);
    });
  }
  const LevelSelect = ({ value, onChange, name, labels }: { value: number; onChange: (n: number) => void; name: string; labels: string[] }) => (
    <label className="field" style={{ minWidth: 88 }}>{name}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {levels.map((l) => <option key={l} value={l} title={labels[l - 1]}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <Dialog title="Nouveau risque" onClose={onClose}>
      <form action={submit}>
        <label className="field field--full">Intitulé du risque
          <input name="title" placeholder="Rançongiciel paralysant le SI…" minLength={2} required />
        </label>
        <label className="field field--full">Scénario
          <textarea name="scenario" rows={2} placeholder="Comment le risque se matérialise…" />
        </label>
        <div className="risk-form-grid">
          <label className="field">Valeur métier
            <input name="businessValue" placeholder="Continuité des expéditions…" />
          </label>
          <label className="field">Périmètre
            <select name="scopeId" defaultValue={scopes[0]?.id} required>{scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label className="field">Traitement
            <select name="treatment" defaultValue="reduire">{Object.entries(TREATMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="field">Propriétaire
            <select name="ownerUserId" defaultValue=""><option value="">— Non attribué —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
          </label>
          <label className="field">Niveau résiduel visé
            <select name="residualTarget" defaultValue=""><option value="">—</option>{(Object.keys(BAND_LABEL) as RiskBand[]).map((b) => <option key={b} value={b}>{BAND_LABEL[b]}</option>)}</select>
          </label>
          <label className="field">Prochaine revue
            <input type="date" name="nextReview" />
          </label>
        </div>
        <div className="rating-block">
          <p className="rating-block-title">Cotation</p>
          <div className="rating-row">
            <div className="rating-pair"><LevelSelect value={gg} onChange={setGg} name="Gravité brute" labels={scale.gLabels} /><LevelSelect value={gv} onChange={setGv} name="Vrais. brute" labels={scale.vLabels} /></div>
            <div className="rating-preview"><Level band={bandOf(gg, gv)} gv={`${gg}×${gv}`} /></div>
          </div>
          <div className="rating-row" style={{ marginTop: 10 }}>
            <div className="rating-pair"><LevelSelect value={ng} onChange={setNg} name="Gravité nette" labels={scale.gLabels} /><LevelSelect value={nv} onChange={setNv} name="Vrais. nette" labels={scale.vLabels} /></div>
            <div className="rating-preview"><Level band={bandOf(ng, nv)} gv={`${ng}×${nv}`} /></div>
          </div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Créer le risque'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function AcceptanceSection({ slug, risk, canManage, onDone }: { slug: string; risk: RiskSummary; canManage: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (risk.acceptanceState === 'non_requise') return null;
  const signed = risk.acceptanceState === 'acceptee' || risk.acceptanceState === 'expiree';

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await acceptRiskAction(slug, { riskId: risk.id, rationale: String(fd.get('rationale') ?? ''), expiresAt: String(fd.get('expiresAt') ?? '') || null });
      if (res.ok) { setOpen(false); onDone(); } else setError(res.error.message);
    });
  }

  return (
    <div className="drawer-section">
      <p className="drawer-section-label">Acceptation formelle</p>
      {signed ? (
        <div className="acc-signature">Acceptée par <b>{risk.acceptedByName ?? '—'}</b> le <b>{risk.acceptedAt ? new Date(risk.acceptedAt).toLocaleDateString('fr-FR') : '—'}</b>.{risk.acceptanceExpiresAt ? <> Revalidation avant <b>{fmtDate(risk.acceptanceExpiresAt)}</b>{risk.acceptanceState === 'expiree' ? ' — échéance dépassée.' : '.'}</> : ' Sans échéance.'}</div>
      ) : (
        <div className="acc-signature" style={{ borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)', background: 'color-mix(in srgb, var(--warn) 8%, transparent)' }}>Marqué « accepter » sans acceptation signée — <b>à remonter en revue de direction</b>.</div>
      )}
      {canManage ? (open ? (
        <form action={submit} style={{ marginTop: 10 }}>
          <label className="field">Motivation<textarea name="rationale" rows={2} minLength={10} required placeholder="Pourquoi ce risque résiduel est-il tolérable…" /></label>
          <label className="field">Échéance de revalidation (optionnelle)<input type="date" name="expiresAt" /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Annuler</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Signature…' : 'Signer l’acceptation'}</button></div>
        </form>
      ) : (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>{signed ? 'Revalider l’acceptation' : 'Signer l’acceptation'}</button>
      )) : null}
    </div>
  );
}

function ControlLinks({ slug, riskId, controls, canManage }: { slug: string; riskId: string; controls: ControlLite[]; canManage: boolean }) {
  const router = useRouter();
  const [linked, setLinked] = useState<Set<string> | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let alive = true;
    getRiskControlsAction(slug, riskId).then((res) => { if (alive && res.ok) setLinked(new Set(res.data.controlIds)); });
    return () => { alive = false; };
  }, [slug, riskId]);

  function toggle(controlId: string, next: boolean) {
    setLinked((s) => { const c = new Set(s ?? []); if (next) c.add(controlId); else c.delete(controlId); return c; });
    start(async () => { const res = await toggleRiskControlAction(slug, { riskId, controlId, linked: next }); if (res.ok) router.refresh(); });
  }

  return (
    <div className="drawer-section">
      <p className="drawer-section-label">Contrôles atténuants</p>
      {controls.length === 0 ? (
        <p className="risk-mut-hint">Aucun contrôle interne — créez-en dans Référentiels.</p>
      ) : linked === null ? (
        <p className="risk-mut-hint">Chargement…</p>
      ) : (
        <div className="control-link-list">
          {controls.map((c) => (
            <label className="control-link-row" key={c.id}>
              <input type="checkbox" checked={linked.has(c.id)} disabled={!canManage || pending} onChange={(e) => toggle(c.id, e.target.checked)} />
              {c.title}
            </label>
          ))}
        </div>
      )}
      <p className="risk-mut-hint" style={{ marginTop: 6 }}>Un contrôle mutualisé qui atténue ce risque prouve aussi la conformité côté référentiels.</p>
    </div>
  );
}
