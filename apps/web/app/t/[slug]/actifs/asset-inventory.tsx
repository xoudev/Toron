'use client';

import type { AssetCategory } from '@toron/core';
import type { AssetSummary, ScopeSummary } from '@toron/db';
import { Dialog, Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { refCode } from '@/lib/format';

import {
  createAssetAction,
  getAssetRisksAction,
  importAssetsCsvAction,
  toggleAssetRiskAction,
} from './asset-actions';

type RiskLite = { id: string; title: string };

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  materiel: 'Matériel',
  logiciel: 'Logiciel',
  donnees: 'Données',
  flux: 'Flux',
};
const AXES: { key: 'd' | 'i' | 'c' | 'p'; label: string }[] = [
  { key: 'd', label: 'D' },
  { key: 'i', label: 'I' },
  { key: 'c', label: 'C' },
  { key: 'p', label: 'P' },
];

function Dicp({ dicp }: { dicp: { d: number; i: number; c: number; p: number } }) {
  return (
    <span className="dicp">
      {AXES.map((a) => (
        <span className="dicp-axis" key={a.key} title={`${a.label} = ${dicp[a.key]}`}>
          <span>{a.label}</span>
          <b className={`lvl${dicp[a.key]}`}>{dicp[a.key]}</b>
        </span>
      ))}
    </span>
  );
}

export function AssetInventory({
  slug,
  canManage,
  assets,
  scopes,
  risks,
}: {
  slug: string;
  canManage: boolean;
  assets: AssetSummary[];
  scopes: ScopeSummary[];
  risks: RiskLite[];
}) {
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openAsset, setOpenAsset] = useState<AssetSummary | null>(null);

  return (
    <>
      {canManage ? (
        <div className="plan-toolbar">
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setImporting(true)}>Importer un CSV</button>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouvel actif</button>
        </div>
      ) : null}

      {assets.length === 0 ? (
        <div className="empty-state"><h2>Aucun actif</h2><p>Ajoutez un actif ou importez votre inventaire au format CSV.</p></div>
      ) : (
        <div className="card asset-table-card">
          <div className="asset-table-wrap">
            <table className="asset-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Actif</th>
                  <th>Catégorie</th>
                  <th>DICP</th>
                  <th>Sensibilité</th>
                  <th>Périmètre</th>
                  <th>Risques</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className="ds-id">{refCode('AST', a.id)}</td>
                    <td className="asset-name-cell" onClick={() => setOpenAsset(a)}>
                      {a.name}
                      {a.description ? <div className="ev-type" style={{ textTransform: 'none' }}>{a.description}</div> : null}
                    </td>
                    <td><span className="cat-tag">{CATEGORY_LABEL[a.category] ?? a.category}</span></td>
                    <td><Dicp dicp={a.dicp} /></td>
                    <td><span className={`sens-badge lvl${a.sensitivity}`}>{a.sensitivity}</span></td>
                    <td>{a.scopeName ?? '—'}</td>
                    <td className="mono">{a.riskCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating ? <CreateDialog slug={slug} scopes={scopes} onClose={() => setCreating(false)} /> : null}
      {importing ? <ImportDialog slug={slug} onClose={() => setImporting(false)} /> : null}
      {openAsset ? (
        <DetailDialog slug={slug} asset={openAsset} risks={risks} canManage={canManage} onClose={() => setOpenAsset(null)} />
      ) : null}
    </>
  );
}

function CreateDialog({ slug, scopes, onClose }: { slug: string; scopes: ScopeSummary[]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createAssetAction(slug, {
        name: String(fd.get('name') ?? ''),
        category: String(fd.get('category') ?? 'materiel'),
        description: String(fd.get('description') ?? '') || null,
        scopeId: String(fd.get('scopeId') ?? '') || null,
        dicpD: fd.get('dicpD'),
        dicpI: fd.get('dicpI'),
        dicpC: fd.get('dicpC'),
        dicpP: fd.get('dicpP'),
      });
      if (res.ok) {
        onClose();
        router.refresh();
      } else setError(res.error.message);
    });
  }

  return (
    <Dialog title="Nouvel actif" onClose={onClose}>
      <form action={submit}>
        <label className="field">
          Intitulé
          <input name="name" minLength={2} required placeholder="Serveur applicatif…" />
        </label>
        <div className="risk-form-grid">
          <label className="field">
            Catégorie
            <select name="category" defaultValue="materiel">
              {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            Périmètre
            <select name="scopeId" defaultValue={scopes[0]?.id ?? ''}>
              <option value="">—</option>
              {scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field field--full">
            Description
            <input name="description" placeholder="Rôle de l’actif…" />
          </label>
        </div>
        <p className="rating-block-title" style={{ marginTop: 8 }}>Cotation DICP (1-4)</p>
        <div className="dicp-fields">
          {[['dicpD', 'Disponibilité'], ['dicpI', 'Intégrité'], ['dicpC', 'Confidentialité'], ['dicpP', 'Preuve']].map(([n, l]) => (
            <label className="field" key={n}>
              {l}
              <select name={n} defaultValue="1">
                {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Création…' : 'Créer'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    setResult(null);
    start(async () => {
      const res = await importAssetsCsvAction(slug, { csv });
      if (res.ok) {
        setResult(res.data);
        router.refresh();
      } else setError(res.error.message);
    });
  }

  return (
    <Dialog title="Importer des actifs (CSV)" onClose={onClose}>
      <p className="csv-hint">En-tête attendu : name, category, description, d, i, c, p</p>
      <p className="csv-hint">Ex. : Serveur WMS,materiel,Serveur logistique,4,3,3,2</p>
      <label className="field">
        Contenu CSV
        <textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="name,category,d,i,c,p&#10;…" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {result ? (
        <div>
          <p style={{ color: 'var(--ok)', fontSize: 13 }}>{result.imported} actif{result.imported > 1 ? 's' : ''} importé{result.imported > 1 ? 's' : ''}.</p>
          {result.errors.length > 0 ? (
            <div className="import-errors">
              {result.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending || csv.trim().length === 0} onClick={submit}>
          {pending ? 'Import…' : 'Importer'}
        </button>
      </div>
    </Dialog>
  );
}

function DetailDialog({
  slug,
  asset,
  risks,
  canManage,
  onClose,
}: {
  slug: string;
  asset: AssetSummary;
  risks: RiskLite[];
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [linked, setLinked] = useState<Set<string> | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getAssetRisksAction(slug, asset.id).then((res) => {
      if (alive && res.ok) setLinked(new Set(res.data.riskIds));
    });
    return () => {
      alive = false;
    };
  }, [slug, asset.id]);

  function toggle(riskId: string, next: boolean) {
    setLinked((s) => {
      const c = new Set(s ?? []);
      if (next) c.add(riskId);
      else c.delete(riskId);
      return c;
    });
    start(async () => {
      const res = await toggleAssetRiskAction(slug, { assetId: asset.id, riskId, linked: next });
      if (res.ok) router.refresh();
    });
  }

  const header = (
    <>
      <span className="ds-id" id="ast-drawer-title">{refCode('AST', asset.id)}</span>
      <span className="cat-tag">{CATEGORY_LABEL[asset.category] ?? asset.category}</span>
      <span className={`sens-badge lvl${asset.sensitivity}`}>Sensibilité {asset.sensitivity}</span>
    </>
  );

  return (
    <Drawer header={header} labelId="ast-drawer-title" onClose={onClose}>
      <div className="drawer-section">
        <div className="ds-primary" style={{ fontSize: 14 }}>{asset.name}</div>
        <div className="doc-meta" style={{ margin: '8px 0' }}><Dicp dicp={asset.dicp} /></div>
        {asset.description ? <p className="ds-muted">{asset.description}</p> : null}
      </div>

      <div className="drawer-section">
        <p className="drawer-section-label">Risques associés</p>
        {risks.length === 0 ? (
          <p className="risk-mut-hint">Aucun risque au registre.</p>
        ) : linked === null ? (
          <p className="risk-mut-hint">Chargement…</p>
        ) : (
          <div className="control-link-list">
            {risks.map((r) => (
              <label className="control-link-row" key={r.id}>
                <input type="checkbox" checked={linked.has(r.id)} disabled={!canManage || pending} onChange={(e) => toggle(r.id, e.target.checked)} />
                {r.title}
              </label>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
