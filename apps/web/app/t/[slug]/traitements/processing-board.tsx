'use client';

import {
  LEGAL_BASES,
  LEGAL_BASIS_LABEL,
  processingGaps,
  processingReviewDue,
  processingWarnings,
  processorAgreementState,
  type LegalBasis,
  type ProcessorAgreementState,
} from '@toron/core';
import type { ProcessingRow, TenantMember } from '@toron/db';
import { Drawer } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { initials, refCode } from '@/lib/format';
import { keepValues } from '@/lib/forms';
import { useOpenItem } from '@/lib/use-open-item';

import { createProcessingAction, deleteProcessingAction, updateProcessingAction } from './processing-actions';

interface Ref { id: string; name: string }

const SHORT_BASIS: Record<LegalBasis, string> = {
  consentement: 'Consentement',
  contrat: 'Contrat',
  obligation_legale: 'Obligation légale',
  interets_vitaux: 'Intérêts vitaux',
  mission_publique: 'Mission publique',
  interet_legitime: 'Intérêt légitime',
};

const AGREEMENT_LABEL: Record<ProcessorAgreementState, string> = {
  couvert: 'accord de traitement en vigueur',
  expire: 'accord de traitement expiré',
  absent: 'aucun accord de traitement enregistré',
};

function fmt(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

const splitList = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

export function ProcessingBoard({ slug, today, canManage, items, suppliers, members, entities }: {
  slug: string; today: string; canManage: boolean; items: ProcessingRow[]; suppliers: Ref[]; members: TenantMember[]; entities: Ref[];
}) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useOpenItem(items.map((p) => p.id));
  const editing = items.find((p) => p.id === openId) ?? null;

  return (
    <>
      <div className="ds-toolbar">
        <span className="drawer-section-label" style={{ margin: 0 }}>Registre · {items.length}</span>
        <span className="spacer" />
        {canManage ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nouvelle fiche</button> : null}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <h2>Aucun traitement recensé</h2>
          <p>Commencez par les traitements courants : gestion du personnel, clients et prospects, fournisseurs, vidéosurveillance, site web.</p>
        </div>
      ) : (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 1040 }}>
            <thead><tr>
              <th style={{ width: 74 }}>ID</th><th style={{ minWidth: 260 }}>Traitement</th><th style={{ width: 130 }}>Base légale</th>
              <th style={{ minWidth: 170 }}>Personnes concernées</th><th style={{ minWidth: 170 }}>Sous-traitants</th>
              <th style={{ width: 120 }}>Fiche</th><th style={{ width: 140 }}>Responsable</th><th style={{ width: 96 }}>Révision</th>
            </tr></thead>
            <tbody>
              {items.map((p) => {
                const gaps = processingGaps(p);
                const due = processingReviewDue(p.lastReviewedOn);
                return (
                  <tr key={p.id} onClick={() => setOpenId(p.id)}>
                    <td className="ds-id">{refCode('TRT', p.id)}</td>
                    <td><div className="ds-primary">{p.name}<small>{p.purpose}</small></div></td>
                    <td><span className="ds-chip">{SHORT_BASIS[p.legalBasis]}</span></td>
                    <td className="ds-refchips">{p.dataSubjects.length ? p.dataSubjects.map((x, i) => <span className="ds-refchip" key={i}><span className="dot" />{x}</span>) : <span className="ds-muted">—</span>}</td>
                    <td>
                      {p.processors.length === 0 ? <span className="ds-muted">—</span> : (
                        <ul className="trt-processors">
                          {p.processors.map((x) => {
                            const state = processorAgreementState(x, today);
                            return <li key={x.supplierId} className={`trt-agreement--${state}`} title={AGREEMENT_LABEL[state]}>{x.name}{state !== 'couvert' ? <span className="sr-only"> ({AGREEMENT_LABEL[state]})</span> : null}</li>;
                          })}
                        </ul>
                      )}
                    </td>
                    <td>{gaps.length === 0 ? <span className="obl-status obl-status--conforme">Complète</span> : <span className="obl-status obl-status--a_evaluer trt-gaps">{gaps.length} manque{gaps.length > 1 ? 's' : ''}</span>}</td>
                    <td><div className="ds-owner"><span className="ds-avatar">{initials(p.ownerName)}</span><span>{p.ownerName ?? '—'}</span></div></td>
                    <td className={`ds-mono${due && due < today ? ' obl-due--en_retard' : ''}`}>{due ? fmt(due) : <span className="ds-muted">À relire</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}

      {creating ? <ProcessingDrawer slug={slug} today={today} item={null} suppliers={suppliers} members={members} entities={entities} canManage={canManage} onClose={() => setCreating(false)} /> : null}
      {editing ? <ProcessingDrawer key={editing.id} slug={slug} today={today} item={editing} suppliers={suppliers} members={members} entities={entities} canManage={canManage} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function ProcessingDrawer({ slug, today, item, suppliers, members, entities, canManage, onClose }: {
  slug: string; today: string; item: ProcessingRow | null; suppliers: Ref[]; members: TenantMember[]; entities: Ref[]; canManage: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = item !== null;
  const [f, setF] = useState({
    name: item?.name ?? '',
    purpose: item?.purpose ?? '',
    legalBasis: (item?.legalBasis ?? 'contrat') as LegalBasis,
    legalBasisDetail: item?.legalBasisDetail ?? '',
    dataSubjects: item?.dataSubjects.join(', ') ?? '',
    dataCategories: item?.dataCategories.join(', ') ?? '',
    sensitiveData: item?.sensitiveData ?? false,
    recipients: item?.recipients ?? '',
    transfersOutsideEu: item?.transfersOutsideEu ?? false,
    transferSafeguards: item?.transferSafeguards ?? '',
    retention: item?.retention ?? '',
    securityMeasures: item?.securityMeasures ?? '',
  });
  const [processors, setProcessors] = useState<Set<string>>(() => new Set(item?.processors.map((x) => x.supplierId) ?? []));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const facts = { ...f, legalBasisDetail: f.legalBasisDetail || null, dataSubjects: splitList(f.dataSubjects), dataCategories: splitList(f.dataCategories), recipients: f.recipients || null, transferSafeguards: f.transferSafeguards || null, retention: f.retention || null, securityMeasures: f.securityMeasures || null };
  const gaps = processingGaps(facts);
  const warnings = processingWarnings(facts);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const text = (k: 'name' | 'purpose' | 'legalBasisDetail' | 'dataSubjects' | 'dataCategories' | 'recipients' | 'transferSafeguards' | 'retention' | 'securityMeasures') =>
    ({ value: f[k], onChange: (e: { target: { value: string } }) => set(k)(e.target.value), disabled: !canManage });

  function submit(fd: FormData) {
    setError(null);
    const payload = {
      ...facts,
      entityId: String(fd.get('entityId') ?? '') || null,
      ownerUserId: String(fd.get('ownerUserId') ?? '') || null,
      lastReviewedOn: String(fd.get('lastReviewedOn') ?? '') || null,
      supplierIds: [...processors],
    };
    start(async () => {
      const r = isEdit ? await updateProcessingAction(slug, { processingId: item!.id, ...payload }) : await createProcessingAction(slug, payload);
      if (r.ok) { onClose(); router.refresh(); } else setError(r.error.message);
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const r = await deleteProcessingAction(slug, item!.id);
      if (r.ok) { onClose(); router.refresh(); } else setError(r.error.message);
    });
  }

  const header = <><span className="ds-id" id="trt-title">{isEdit ? refCode('TRT', item!.id) : 'Nouvelle'}</span><span className="ds-chip">Fiche de traitement</span></>;
  return (
    <Drawer header={header} labelId="trt-title" onClose={onClose}>
      <form onSubmit={keepValues(submit)} className="drawer-wide">
        <div className={`trt-check${gaps.length === 0 ? ' trt-check--ok' : ''}`} aria-live="polite">
          {gaps.length === 0 ? 'Toutes les rubriques de l’article 30 sont renseignées.' : <>À compléter : {gaps.join(', ')}.</>}
        </div>
        {warnings.length > 0 ? <ul className="trt-warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}

        <label className="field">Nom du traitement<input required minLength={2} maxLength={200} {...text('name')} /></label>
        <label className="field">Finalité<textarea rows={2} required maxLength={2000} {...text('purpose')} /></label>
        <div className="risk-form-grid">
          <label className="field">Base légale<select value={f.legalBasis} onChange={(e) => set('legalBasis')(e.target.value as LegalBasis)} disabled={!canManage}>{LEGAL_BASES.map((b) => <option key={b} value={b}>{LEGAL_BASIS_LABEL[b]}</option>)}</select></label>
          <label className="field">Responsable<select name="ownerUserId" defaultValue={item?.ownerUserId ?? ''} disabled={!canManage}><option value="">— Non attribué —</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
        </div>
        {f.legalBasis === 'interet_legitime' ? <label className="field">Intérêt légitime poursuivi<textarea rows={2} maxLength={2000} {...text('legalBasisDetail')} /></label> : null}

        <p className="drawer-section-label">Personnes et données</p>
        <label className="field">Personnes concernées (séparées par des virgules)<input placeholder="Salariés, Clients, Visiteurs…" {...text('dataSubjects')} /></label>
        <label className="field">Catégories de données (séparées par des virgules)<input placeholder="Identité, Coordonnées, Données bancaires…" {...text('dataCategories')} /></label>
        <label className="trt-check-line"><input type="checkbox" checked={f.sensitiveData} onChange={(e) => set('sensitiveData')(e.target.checked)} disabled={!canManage} /> Données sensibles (santé, opinions, biométrie… — art. 9)</label>

        <p className="drawer-section-label">Destinataires et transferts</p>
        <label className="field">Destinataires<textarea rows={2} maxLength={2000} placeholder="Services internes, partenaires, autorités…" {...text('recipients')} /></label>
        <label className="trt-check-line"><input type="checkbox" checked={f.transfersOutsideEu} onChange={(e) => set('transfersOutsideEu')(e.target.checked)} disabled={!canManage} /> Transfert de données hors de l’Union européenne</label>
        {f.transfersOutsideEu ? <label className="field">Garanties du transfert<textarea rows={2} required maxLength={2000} placeholder="Décision d’adéquation, clauses contractuelles types…" {...text('transferSafeguards')} /></label> : null}

        <fieldset className="trt-processors-pick" disabled={!canManage}>
          <legend>Sous-traitants (registre des fournisseurs)</legend>
          {suppliers.length === 0 ? <p className="ds-muted">Aucun fournisseur enregistré.</p> : suppliers.map((s) => {
            const ref = item?.processors.find((x) => x.supplierId === s.id);
            const state = ref ? processorAgreementState(ref, today) : null;
            return (
              <label key={s.id} className="trt-check-line">
                <input type="checkbox" checked={processors.has(s.id)} onChange={(e) => setProcessors((prev) => { const next = new Set(prev); if (e.target.checked) next.add(s.id); else next.delete(s.id); return next; })} />
                {s.name}{state && state !== 'couvert' ? <span className={`trt-agreement-note trt-agreement--${state}`}> — {AGREEMENT_LABEL[state]}</span> : null}
              </label>
            );
          })}
        </fieldset>

        <p className="drawer-section-label">Conservation et sécurité</p>
        <label className="field">Durée de conservation<input maxLength={1000} placeholder="3 ans après la fin de la relation, 30 jours…" {...text('retention')} /></label>
        <label className="field">Mesures de sécurité<textarea rows={2} maxLength={4000} placeholder="Contrôle d’accès, MFA, chiffrement, journalisation…" {...text('securityMeasures')} /></label>

        <div className="risk-form-grid">
          <label className="field">Entité<select name="entityId" defaultValue={item?.entityId ?? entities[0]?.id ?? ''} disabled={!canManage}><option value="">Toute l’organisation</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="field">Dernière relecture<input type="date" name="lastReviewedOn" max={today} defaultValue={item?.lastReviewedOn ?? ''} disabled={!canManage} /></label>
        </div>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {canManage ? (
          <div className="dialog-actions">
            {isEdit && !confirming ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>Supprimer</button> : null}
            {confirming ? <><span className="obl-confirm">Supprimer la fiche ?</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Annuler</button><button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={pending}>Supprimer</button></> : null}
            <span className="spacer" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'}</button>
          </div>
        ) : null}
      </form>
    </Drawer>
  );
}
