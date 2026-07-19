'use client';

import type { SupplierSummary, TenantMember } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';

import { createSupplierAction, updateSupplierAction } from './supplier-actions';

const TIER_LABEL: Record<string, string> = { t1: 'T1 · critique', t2: 'T2', t3: 'T3' };
const CONTRACT_LABEL: Record<string, string> = { a_faire: 'À faire', en_cours: 'En cours', conforme: 'Conforme' };

function fmt(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function SupplierBoard({ slug, canManage, suppliers, members }: { slug: string; canManage: boolean; suppliers: SupplierSummary[]; members: TenantMember[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SupplierSummary | null>(null);

  return (
    <>
      <div className="ds-toolbar">
        <span className="drawer-section-label" style={{ margin: 0 }}>Registre · {suppliers.length}</span>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouveau fournisseur</button> : null}
      </div>

      {suppliers.length === 0 ? (
        <div className="empty-state"><h2>Aucun fournisseur</h2><p>Recensez vos tiers pour piloter l’effet cascade sur votre conformité.</p></div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 880 }}>
            <thead><tr>
              <th style={{ width: 74 }}>ID</th><th style={{ minWidth: 220 }}>Fournisseur</th><th style={{ width: 96 }}>Niveau</th>
              <th style={{ minWidth: 200 }}>Données confiées</th><th style={{ width: 110 }}>Contrat</th><th style={{ width: 140 }}>Propriétaire</th><th style={{ width: 92 }}>Revue</th>
            </tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} onClick={() => setEditing(s)}>
                  <td className="ds-id">{refCode('FRN', s.id)}</td>
                  <td><div className="ds-primary">{s.name}{s.services ? <small>{s.services}</small> : null}</div></td>
                  <td><span className={`ds-chip${s.tier === 't1' ? ' accent' : ''}`}>{TIER_LABEL[s.tier]}</span></td>
                  <td className="ds-refchips">{s.dataCategories.length ? s.dataCategories.map((c, i) => <span className="ds-refchip" key={i}><span className="dot" />{c}</span>) : <span className="ds-muted">—</span>}</td>
                  <td><span className={`nc-status ncs--${s.contractStatus === 'conforme' ? 'efficace' : s.contractStatus === 'en_cours' ? 'en_traitement' : 'ouverte'}`}>{CONTRACT_LABEL[s.contractStatus]}</span></td>
                  <td><div className="ds-owner"><span className="ds-avatar">{initials(s.ownerName)}</span><span>{s.ownerName ?? '—'}</span></div></td>
                  <td className="ds-mono">{fmt(s.nextReview)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? <SupplierDrawer slug={slug} members={members} supplier={null} canManage={canManage} onClose={() => setCreating(false)} /> : null}
      {editing ? <SupplierDrawer slug={slug} members={members} supplier={editing} canManage={canManage} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function SupplierDrawer({ slug, members, supplier, canManage, onClose }: { slug: string; members: TenantMember[]; supplier: SupplierSummary | null; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const isEdit = supplier !== null;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    const cats = String(fd.get('dataCategories') ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    const payload = { name: String(fd.get('name') ?? ''), tier: String(fd.get('tier') ?? 't3'), services: String(fd.get('services') ?? '') || null, dataCategories: cats, contractStatus: String(fd.get('contractStatus') ?? 'a_faire'), ownerUserId: String(fd.get('ownerUserId') ?? '') || null, nextReview: String(fd.get('nextReview') ?? '') || null };
    start(async () => {
      const res = isEdit ? await updateSupplierAction(slug, { supplierId: supplier!.id, ...payload }) : await createSupplierAction(slug, payload);
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error.message);
    });
  }

  const header = (
    <>
      <span className="ds-id" id="frn-title">{isEdit ? refCode('FRN', supplier!.id) : 'Nouveau'}</span>
      <span className="ds-chip">Fournisseur</span>
    </>
  );

  return (
    <Drawer header={header} labelId="frn-title" onClose={onClose}>
      <form action={submit}>
        <label className="field">Nom<input name="name" defaultValue={supplier?.name ?? ''} minLength={2} required disabled={!canManage} /></label>
        <label className="field">Services fournis<textarea name="services" defaultValue={supplier?.services ?? ''} rows={2} disabled={!canManage} /></label>
        <div className="risk-form-grid">
          <label className="field">Niveau (tiering)<select name="tier" defaultValue={supplier?.tier ?? 't3'} disabled={!canManage}><option value="t1">T1 · critique</option><option value="t2">T2</option><option value="t3">T3</option></select></label>
          <label className="field">Clauses contractuelles<select name="contractStatus" defaultValue={supplier?.contractStatus ?? 'a_faire'} disabled={!canManage}>{Object.entries(CONTRACT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field">Propriétaire<select name="ownerUserId" defaultValue={supplier?.ownerUserId ?? ''} disabled={!canManage}><option value="">— Non attribué —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          <label className="field">Prochaine revue<input type="date" name="nextReview" defaultValue={supplier?.nextReview?.slice(0, 10) ?? ''} disabled={!canManage} /></label>
          <label className="field field--full">Données confiées (séparées par des virgules)<input name="dataCategories" defaultValue={supplier?.dataCategories.join(', ') ?? ''} placeholder="Données clients, Données RH…" disabled={!canManage} /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {canManage ? (
          <div className="dialog-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button><button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'}</button></div>
        ) : null}
      </form>
    </Drawer>
  );
}
