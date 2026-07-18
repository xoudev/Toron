'use client';

import type { RiskBand } from '@toron/core';
import type { RiskSummary, ScopeSummary, TenantMember } from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

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
const ACC_LABEL: Record<string, string> = {
  acceptee: 'Acceptée',
  en_attente: 'Acceptation en attente',
  expiree: 'Revalidation requise',
  non_requise: '—',
};

function BandPill({ band, gv }: { band: RiskBand | null; gv?: string }) {
  if (!band) return <span className="risk-controls-count">—</span>;
  return (
    <span className={`band-pill band--${band}`}>
      {BAND_LABEL[band]}
      {gv ? <span className="mono" style={{ opacity: 0.7 }}>{gv}</span> : null}
    </span>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RiskSummary | null>(null);

  const bandOf = (g: number, v: number): RiskBand | null =>
    g >= 1 && v >= 1 && g <= scale.size && v <= scale.size ? scale.bands[g - 1]?.[v - 1] ?? null : null;

  // Comptage par cellule (cotation NETTE) pour la carte de chaleur.
  const cellCount = (g: number, v: number): number =>
    risks.filter((r) => r.netG === g && r.netV === v).length;

  const shown = filter ? risks.filter((r) => r.netG === filter.g && r.netV === filter.v) : risks;

  const levels = Array.from({ length: scale.size }, (_, i) => i + 1);

  return (
    <div className="risk-layout">
      {/* ── Matrice filtrante ────────────────────────────────────────── */}
      <div className="card risk-matrix-card">
        <p className="risk-matrix-title">Matrice des risques nets</p>
        <p className="risk-matrix-sub">Gravité (lignes) × Vraisemblance (colonnes). Cliquez une case pour filtrer.</p>
        <div
          className="risk-matrix"
          style={{ gridTemplateColumns: `18px repeat(${scale.size}, 1fr)` }}
        >
          {levels
            .slice()
            .reverse()
            .map((g) => (
              <RowFragment
                key={g}
                g={g}
                levels={levels}
                bandOf={bandOf}
                cellCount={cellCount}
                gLabel={scale.gLabels[g - 1] ?? String(g)}
                vLabels={scale.vLabels}
                filter={filter}
                onPick={(gg, vv) =>
                  setFilter((f) => (f && f.g === gg && f.v === vv ? null : { g: gg, v: vv }))
                }
              />
            ))}
          <span className="matrix-corner" title="Gravité / Vraisemblance">
            G/V
          </span>
          {levels.map((v) => (
            <span className="matrix-corner" key={v} style={{ textAlign: 'center' }} title={scale.vLabels[v - 1]}>
              {v}
            </span>
          ))}
        </div>
        {filter ? (
          <button className="link-btn risk-filter-clear" onClick={() => setFilter(null)}>
            Filtre actif : G{filter.g}×V{filter.v} — tout afficher
          </button>
        ) : null}
      </div>

      {/* ── Registre ─────────────────────────────────────────────────── */}
      <div className="card risk-table-card">
        <div className="risk-table-wrap">
          <table className="risk-table">
            <thead>
              <tr>
                <th>Risque</th>
                <th>Périmètre</th>
                <th>Brut</th>
                <th>Net</th>
                <th>Traitement</th>
                <th>Propriétaire</th>
                <th>Revue</th>
                <th>Acceptation</th>
                <th>Contrôles</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '28px' }}>
                    {filter ? 'Aucun risque dans cette case.' : 'Aucun risque enregistré.'}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} onClick={() => setEditing(r)}>
                    <td className="risk-title-cell">
                      {r.title}
                      {r.acceptanceState === 'en_attente' || r.acceptanceState === 'expiree' ? (
                        <small>À remonter en revue de direction</small>
                      ) : null}
                    </td>
                    <td>{r.scopeName}</td>
                    <td>
                      <BandPill band={r.grossBand} gv={`${r.grossG}×${r.grossV}`} />
                    </td>
                    <td>
                      <BandPill band={r.netBand} gv={`${r.netG}×${r.netV}`} />
                    </td>
                    <td>
                      <span className="treatment-tag">{TREATMENT_LABEL[r.treatment] ?? r.treatment}</span>
                    </td>
                    <td>{r.ownerName ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(r.nextReview)}</td>
                    <td>
                      <span className={`acc-pill acc--${r.acceptanceState}`}>{ACC_LABEL[r.acceptanceState]}</span>
                    </td>
                    <td className="risk-controls-count">{r.controlCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canManage && creating ? (
        <RiskDialog
          slug={slug}
          scale={scale}
          scopes={scopes}
          members={members}
          controls={controls}
          bandOf={bandOf}
          risk={null}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {editing ? (
        <RiskDialog
          slug={slug}
          scale={scale}
          scopes={scopes}
          members={members}
          controls={controls}
          bandOf={bandOf}
          risk={editing}
          canManage={canManage}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {canManage ? (
        <button
          className="btn btn-primary"
          style={{ position: 'fixed', right: 28, bottom: 28, zIndex: 20 }}
          onClick={() => setCreating(true)}
        >
          + Nouveau risque
        </button>
      ) : null}
    </div>
  );
}

function RowFragment({
  g,
  levels,
  bandOf,
  cellCount,
  gLabel,
  filter,
  onPick,
}: {
  g: number;
  levels: number[];
  bandOf: (g: number, v: number) => RiskBand | null;
  cellCount: (g: number, v: number) => number;
  gLabel: string;
  vLabels: string[];
  filter: { g: number; v: number } | null;
  onPick: (g: number, v: number) => void;
}) {
  return (
    <>
      <span className="matrix-corner" style={{ alignSelf: 'center', textAlign: 'center' }} title={gLabel}>
        {g}
      </span>
      {levels.map((v) => {
        const band = bandOf(g, v);
        const count = cellCount(g, v);
        const pressed = filter?.g === g && filter?.v === v;
        return (
          <button
            key={v}
            type="button"
            className={`matrix-cell band--${band ?? 'faible'}${count === 0 ? ' matrix-cell--empty' : ''}`}
            aria-pressed={pressed}
            title={`Gravité ${g} × Vraisemblance ${v} — ${count} risque${count > 1 ? 's' : ''}`}
            onClick={() => (count > 0 || pressed ? onPick(g, v) : undefined)}
          >
            {count > 0 ? count : ''}
          </button>
        );
      })}
    </>
  );
}

// ── Fiche risque (création / édition) ───────────────────────────────────
function RiskDialog({
  slug,
  scale,
  scopes,
  members,
  controls,
  bandOf,
  risk,
  canManage = true,
  onClose,
}: {
  slug: string;
  scale: ScaleView;
  scopes: ScopeSummary[];
  members: TenantMember[];
  controls: ControlLite[];
  bandOf: (g: number, v: number) => RiskBand | null;
  risk: RiskSummary | null;
  canManage?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = risk !== null;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const levels = Array.from({ length: scale.size }, (_, i) => i + 1);

  // Cotation contrôlée (aperçu de bande en direct).
  const [gg, setGg] = useState(risk?.grossG ?? 3);
  const [gv, setGv] = useState(risk?.grossV ?? 3);
  const [ng, setNg] = useState(risk?.netG ?? 2);
  const [nv, setNv] = useState(risk?.netV ?? 2);

  function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>, close = false) {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        router.refresh();
        if (close) onClose();
      } else {
        setError(res.error?.message ?? 'Action refusée.');
      }
    });
  }

  function submitCreate(fd: FormData) {
    run(
      () =>
        createRiskAction(slug, {
          title: String(fd.get('title') ?? ''),
          scopeId: String(fd.get('scopeId') ?? ''),
          scenario: String(fd.get('scenario') ?? '') || null,
          businessValue: String(fd.get('businessValue') ?? '') || null,
          treatment: String(fd.get('treatment') ?? 'reduire'),
          residualTarget: String(fd.get('residualTarget') ?? '') || null,
          ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
          nextReview: String(fd.get('nextReview') ?? '') || null,
          grossG: gg,
          grossV: gv,
          netG: ng,
          netV: nv,
        }),
      true,
    );
  }

  function submitDetails(fd: FormData) {
    if (!risk) return;
    run(() =>
      saveRiskDetailsAction(slug, {
        riskId: risk.id,
        title: String(fd.get('title') ?? ''),
        scopeId: String(fd.get('scopeId') ?? ''),
        scenario: String(fd.get('scenario') ?? '') || null,
        businessValue: String(fd.get('businessValue') ?? '') || null,
        treatment: String(fd.get('treatment') ?? 'reduire'),
        residualTarget: String(fd.get('residualTarget') ?? '') || null,
        ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
        nextReview: String(fd.get('nextReview') ?? '') || null,
      }),
    );
  }

  const LevelSelect = ({ value, onChange, name, labels }: { value: number; onChange: (n: number) => void; name: string; labels: string[] }) => (
    <label className="field" style={{ minWidth: 92 }}>
      {name}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={!canManage}>
        {levels.map((l) => (
          <option key={l} value={l} title={labels[l - 1]}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Dialog title={isEdit ? 'Fiche risque' : 'Nouveau risque'} onClose={onClose}>
      <form action={isEdit ? submitDetails : submitCreate}>
        <div className="risk-form-grid">
          <label className="field field--full">
            Intitulé du risque
            <input name="title" defaultValue={risk?.title ?? ''} placeholder="Rançongiciel paralysant le SI…" minLength={2} required disabled={!canManage} />
          </label>
          <label className="field field--full">
            Scénario
            <textarea name="scenario" defaultValue={risk?.scenario ?? ''} rows={2} placeholder="Comment le risque se matérialise…" disabled={!canManage} />
          </label>
          <label className="field field--full">
            Valeur métier menacée
            <input name="businessValue" defaultValue={risk?.businessValue ?? ''} placeholder="Continuité des expéditions…" disabled={!canManage} />
          </label>
          <label className="field">
            Périmètre
            <select name="scopeId" defaultValue={risk?.scopeId ?? scopes[0]?.id} required disabled={!canManage}>
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Traitement
            <select name="treatment" defaultValue={risk?.treatment ?? 'reduire'} disabled={!canManage}>
              {Object.entries(TREATMENT_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Propriétaire
            <select name="ownerUserId" defaultValue={risk?.ownerUserId ?? ''} disabled={!canManage}>
              <option value="">— Non attribué —</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Niveau résiduel visé
            <select name="residualTarget" defaultValue={risk?.residualTarget ?? ''} disabled={!canManage}>
              <option value="">—</option>
              {(Object.keys(BAND_LABEL) as RiskBand[]).map((b) => (
                <option key={b} value={b}>{BAND_LABEL[b]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Prochaine revue
            <input type="date" name="nextReview" defaultValue={risk?.nextReview?.slice(0, 10) ?? ''} disabled={!canManage} />
          </label>
        </div>

        {/* Cotation : à la création, soumise avec le reste ; en édition, bouton dédié. */}
        <div className="rating-block">
          <p className="rating-block-title">Cotation</p>
          <div className="rating-row">
            <div className="rating-pair">
              <LevelSelect value={gg} onChange={setGg} name="Gravité brute" labels={scale.gLabels} />
              <LevelSelect value={gv} onChange={setGv} name="Vrais. brute" labels={scale.vLabels} />
            </div>
            <div className="rating-preview">
              <BandPill band={bandOf(gg, gv)} gv={`${gg}×${gv}`} />
            </div>
          </div>
          <div className="rating-row" style={{ marginTop: 10 }}>
            <div className="rating-pair">
              <LevelSelect value={ng} onChange={setNg} name="Gravité nette" labels={scale.gLabels} />
              <LevelSelect value={nv} onChange={setNv} name="Vrais. nette" labels={scale.vLabels} />
            </div>
            <div className="rating-preview">
              <BandPill band={bandOf(ng, nv)} gv={`${ng}×${nv}`} />
            </div>
            {isEdit && canManage ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pending}
                onClick={() => run(() => rateRiskAction(slug, { riskId: risk!.id, grossG: gg, grossV: gv, netG: ng, netV: nv }))}
              >
                Recoter
              </button>
            ) : null}
          </div>
        </div>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        {canManage ? (
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              {pending ? 'Enregistrement…' : isEdit ? 'Enregistrer les détails' : 'Créer le risque'}
            </button>
          </div>
        ) : null}
      </form>

      {isEdit ? (
        <>
          <AcceptanceSection slug={slug} risk={risk!} canManage={canManage} onDone={() => router.refresh()} />
          <ControlLinks slug={slug} riskId={risk!.id} controls={controls} canManage={canManage} />
        </>
      ) : null}
    </Dialog>
  );
}

function AcceptanceSection({
  slug,
  risk,
  canManage,
  onDone,
}: {
  slug: string;
  risk: RiskSummary;
  canManage: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (risk.acceptanceState === 'non_requise') return null;

  const signed = risk.acceptanceState === 'acceptee' || risk.acceptanceState === 'expiree';

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await acceptRiskAction(slug, {
        riskId: risk.id,
        rationale: String(fd.get('rationale') ?? ''),
        expiresAt: String(fd.get('expiresAt') ?? '') || null,
      });
      if (res.ok) {
        setOpen(false);
        onDone();
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div style={{ marginTop: 16 }}>
      <p className="rating-block-title">Acceptation formelle</p>
      {signed ? (
        <div className="acc-signature">
          Acceptée par <b>{risk.acceptedByName ?? '—'}</b> le{' '}
          <b>{risk.acceptedAt ? new Date(risk.acceptedAt).toLocaleDateString('fr-FR') : '—'}</b>.
          {risk.acceptanceExpiresAt ? (
            <>
              {' '}Revalidation avant <b>{fmtDate(risk.acceptanceExpiresAt)}</b>
              {risk.acceptanceState === 'expiree' ? ' — échéance dépassée.' : '.'}
            </>
          ) : (
            ' Sans échéance de revalidation.'
          )}
        </div>
      ) : (
        <div className="acc-signature" style={{ borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)', background: 'color-mix(in srgb, var(--warn) 8%, transparent)' }}>
          Risque marqué « accepter » sans acceptation signée — <b>à remonter en revue de direction</b>.
        </div>
      )}
      {canManage ? (
        open ? (
          <form action={submit} style={{ marginTop: 10 }}>
            <label className="field">
              Motivation de l’acceptation
              <textarea name="rationale" rows={2} minLength={10} required placeholder="Pourquoi ce risque résiduel est-il tolérable…" />
            </label>
            <label className="field">
              Échéance de revalidation (optionnelle)
              <input type="date" name="expiresAt" />
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                {pending ? 'Signature…' : 'Signer l’acceptation'}
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
            {signed ? 'Revalider l’acceptation' : 'Signer l’acceptation'}
          </button>
        )
      ) : null}
    </div>
  );
}

function ControlLinks({
  slug,
  riskId,
  controls,
  canManage,
}: {
  slug: string;
  riskId: string;
  controls: ControlLite[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [linked, setLinked] = useState<Set<string> | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getRiskControlsAction(slug, riskId).then((res) => {
      if (alive && res.ok) setLinked(new Set(res.data.controlIds));
    });
    return () => {
      alive = false;
    };
  }, [slug, riskId]);

  function toggle(controlId: string, next: boolean) {
    setLinked((s) => {
      const copy = new Set(s ?? []);
      if (next) copy.add(controlId);
      else copy.delete(controlId);
      return copy;
    });
    start(async () => {
      const res = await toggleRiskControlAction(slug, { riskId, controlId, linked: next });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 16 }}>
      <p className="rating-block-title">Contrôles atténuants</p>
      {controls.length === 0 ? (
        <p className="risk-mut-hint">Aucun contrôle interne — créez-en dans Référentiels.</p>
      ) : linked === null ? (
        <p className="risk-mut-hint">Chargement…</p>
      ) : (
        <div className="control-link-list">
          {controls.map((c) => (
            <label className="control-link-row" key={c.id}>
              <input
                type="checkbox"
                checked={linked.has(c.id)}
                disabled={!canManage || pending}
                onChange={(e) => toggle(c.id, e.target.checked)}
              />
              {c.title}
            </label>
          ))}
        </div>
      )}
      <p className="risk-mut-hint" style={{ marginTop: 6 }}>
        Un contrôle mutualisé qui atténue ce risque prouve aussi la conformité côté référentiels.
      </p>
    </div>
  );
}
