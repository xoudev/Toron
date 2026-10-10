'use client';

import {
  INVITATION_STATE_LABEL, MEMBERSHIP_ROLES, MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_ROLE_PURPOSE, PERMISSION_MODULES,
  assignableRoles, invitationState, modulePermission, totpRequiredForRole, type MembershipRole, type ModulePermission,
} from '@toron/core';
import type { InvitationRow, TenantMemberDetail } from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { initials } from '@/lib/format';
import { keepValues } from '@/lib/forms';

import { changeMemberRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from './actions';
import type { Viewer } from './parametres-client';

const PERM_LABEL: Record<ModulePermission, string> = { gestion: 'Gestion', constat: 'Constats', lecture: 'Lecture', aucun: '—' };

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function SectionMembres({ slug, viewer, members, invitations }: {
  slug: string; viewer: Viewer; members: TenantMemberDetail[]; invitations: InvitationRow[];
}) {
  return (
    <>
      <MembersCard slug={slug} viewer={viewer} members={members} />
      {viewer.canManageMembers ? <InviteCard slug={slug} viewer={viewer} invitations={invitations} /> : null}
      <PermissionMatrix />
    </>
  );
}

function MembersCard({ slug, viewer, members }: { slug: string; viewer: Viewer; members: TenantMemberDetail[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TenantMemberDetail | null>(null);
  // Le choix dans la liste ne fait que proposer : rien n'est envoyé au
  // serveur avant confirmation (une flèche au clavier suffit à changer la
  // valeur d'une liste fermée).
  const [changing, setChanging] = useState<{ member: TenantMemberDetail; role: MembershipRole } | null>(null);
  const [pending, start] = useTransition();
  const allowed = assignableRoles(viewer.role);

  function changeRole(m: TenantMemberDetail, role: MembershipRole) {
    setError(null);
    start(async () => {
      const res = await changeMemberRoleAction(slug, { userId: m.userId, role });
      if (res.ok) { setChanging(null); router.refresh(); } else setError(res.error.message);
    });
  }
  function remove(m: TenantMemberDetail) {
    setError(null);
    start(async () => {
      const res = await removeMemberAction(slug, { userId: m.userId });
      if (res.ok) { setRemoving(null); router.refresh(); } else setError(res.error.message);
    });
  }
  function canEdit(m: TenantMemberDetail): boolean {
    if (!viewer.canManageMembers || m.userId === viewer.userId) return false;
    if (m.role === 'owner' && viewer.role !== 'owner') return false;
    return true;
  }

  return (
    <article className="card settings-card">
      <div className="settings-card-head">
        <div>
          <h2>Membres ({members.length})</h2>
          <p className="hint">
            Un rôle par membre et par organisation. Les rôles Propriétaire, Direction et RSSI exigent la
            double authentification : sans elle, l’accès à l’espace reste bloqué. La direction est
            suivie pour la formation des dirigeants (NIS 2, art. 20) ; à défaut de membre Direction,
            le propriétaire l’est à sa place.
          </p>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="ds-table-card"><div className="ds-scroll">
        <table className="ds-table" style={{ minWidth: 760 }}>
          <thead><tr><th>Membre</th><th style={{ width: 200 }}>Rôle</th><th style={{ width: 150 }}>Double authentification</th><th style={{ width: 110 }}>Depuis</th>{viewer.canManageMembers ? <th style={{ width: 90 }} /> : null}</tr></thead>
          <tbody>
            {members.map((m) => {
              const totpNeeded = totpRequiredForRole(m.role);
              return (
                <tr key={m.userId} style={{ cursor: 'default' }}>
                  <td>
                    <div className="ds-owner">
                      <span className="ds-avatar">{initials(m.name)}</span>
                      <span className="ds-primary">{m.name || m.email}{m.userId === viewer.userId ? ' (vous)' : ''}<small>{m.email}</small></span>
                    </div>
                  </td>
                  <td>
                    {canEdit(m) ? (
                      <select className="role-select" value={m.role} aria-label={`Rôle de ${m.name}`} disabled={pending} onChange={(e) => { const role = e.target.value as MembershipRole; if (role !== m.role) { setError(null); setChanging({ member: m, role }); } }}>
                        {MEMBERSHIP_ROLES.map((r) => <option key={r} value={r} disabled={!allowed.includes(r)}>{MEMBERSHIP_ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : <span className="ds-chip">{MEMBERSHIP_ROLE_LABEL[m.role]}</span>}
                  </td>
                  <td>
                    {m.twoFactorEnabled ? <span className="pill pill--ok">Activée</span>
                      : totpNeeded ? <span className="pill pill--warn" title="Ce rôle exige le TOTP : l’accès reste bloqué jusqu’à l’activation">Requise · non activée</span>
                      : <span className="pill pill--muted">Non activée</span>}
                  </td>
                  <td className="ds-mono">{fmtDate(m.memberSince)}</td>
                  {viewer.canManageMembers ? (
                    <td style={{ textAlign: 'right' }}>
                      {canEdit(m) ? <button className="btn btn-ghost btn-sm" onClick={() => { setError(null); setRemoving(m); }}>Retirer</button> : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div></div>
      {changing ? (
        <Dialog title={`Passer ${changing.member.name || changing.member.email} de ${MEMBERSHIP_ROLE_LABEL[changing.member.role]} à ${MEMBERSHIP_ROLE_LABEL[changing.role]} ?`} onClose={() => setChanging(null)}>
          <p className="hint">
            {MEMBERSHIP_ROLE_LABEL[changing.role]} — {MEMBERSHIP_ROLE_PURPOSE[changing.role]} Le changement prend effet immédiatement.
          </p>
          {changing.role === 'owner' ? (
            <p className="hint"><b>Un propriétaire a tous les droits</b>, y compris changer votre rôle ou vous retirer de l’organisation.</p>
          ) : null}
          {totpRequiredForRole(changing.role) && !changing.member.twoFactorEnabled ? (
            <p className="hint"><b>Ce rôle exige la double authentification</b>, que ce membre n’a pas activée : son accès sera bloqué jusqu’à ce qu’il l’active.</p>
          ) : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setChanging(null)}>Annuler</button>
            <button className="btn btn-primary btn-sm" onClick={() => changeRole(changing.member, changing.role)} disabled={pending}>{pending ? 'Changement…' : 'Changer le rôle'}</button>
          </div>
        </Dialog>
      ) : null}
      {removing ? (
        <Dialog title="Retirer ce membre ?" onClose={() => setRemoving(null)}>
          <p className="hint">
            <b>{removing.name || removing.email}</b> perdra immédiatement l’accès à cette organisation. Les objets
            dont il est responsable restent en place : réattribuez-les ensuite.
          </p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(null)}>Annuler</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(removing)} disabled={pending}>{pending ? 'Retrait…' : 'Retirer'}</button>
          </div>
        </Dialog>
      ) : null}
    </article>
  );
}

function InviteCard({ slug, viewer, invitations }: { slug: string; viewer: Viewer; invitations: InvitationRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ link: string; email: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const now = new Date();
  // Le rôle de propriétaire ne s'attribue jamais par invitation (voir le texte d'aide).
  const canNameOwner = assignableRoles(viewer.role).includes('owner');
  const roles = assignableRoles(viewer.role).filter((r) => r !== 'owner');
  const visible = invitations.filter((i) => invitationState(i, now) !== 'revoquee').slice(0, 20);

  function submit(fd: FormData, form: HTMLFormElement) {
    setError(null); setCreated(null); setCopied(false);
    start(async () => {
      const res = await inviteMemberAction(slug, { email: String(fd.get('email') ?? ''), role: String(fd.get('role') ?? '') });
      if (res.ok) { form.reset(); setCreated(res.data); router.refresh(); } else setError(res.error.message);
    });
  }
  function revoke(id: string) {
    setError(null);
    start(async () => {
      const res = await revokeInvitationAction(slug, { id });
      if (res.ok) router.refresh(); else setError(res.error.message);
    });
  }
  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="card settings-card">
      <div className="settings-card-head">
        <div>
          <h2>Inviter un membre</h2>
          <p className="hint">
            Un lien personnel, valable 7 jours, à transmettre à la personne invitée. Il ne fonctionne
            qu’avec un compte portant exactement cette adresse e-mail. Invitez votre dirigeant avec le
            rôle Direction : il sera suivi pour la formation NIS 2 des dirigeants.
            {canNameOwner ? ' Pour nommer un autre propriétaire, invitez-le avec le rôle Direction puis changez son rôle dans la liste une fois l’invitation acceptée.' : null}
          </p>
        </div>
      </div>
      <form onSubmit={keepValues(submit)}>
        <div className="settings-grid">
          <label className="field">Adresse e-mail professionnelle<input name="email" type="email" required maxLength={254} placeholder="prenom.nom@entreprise.fr" /></label>
          <label className="field">Rôle
            <select name="role" defaultValue="contributeur" required>
              {roles.map((r) => <option key={r} value={r}>{MEMBERSHIP_ROLE_LABEL[r]} — {MEMBERSHIP_ROLE_PURPOSE[r]}</option>)}
            </select>
          </label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="settings-actions">
          <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>{pending ? 'Création…' : 'Générer le lien d’invitation'}</button>
        </div>
      </form>
      {created ? (
        <div className="invite-link" role="status">
          <p><b>Invitation prête pour {created.email}</b> — transmettez ce lien par votre messagerie habituelle. Il expire le {fmtDate(new Date(created.expiresAt))} et n’est affiché qu’une seule fois.</p>
          <div className="invite-link-row">
            <input value={created.link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Lien d’invitation" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{copied ? 'Copié' : 'Copier'}</button>
          </div>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="ds-table-card"><div className="ds-scroll">
          <table className="ds-table" style={{ minWidth: 640 }}>
            <thead><tr><th>Invité</th><th style={{ width: 170 }}>Rôle</th><th style={{ width: 120 }}>État</th><th style={{ width: 110 }}>Expire</th><th style={{ width: 90 }} /></tr></thead>
            <tbody>
              {visible.map((i) => {
                const state = invitationState(i, now);
                return (
                  <tr key={i.id} style={{ cursor: 'default' }}>
                    <td><span className="ds-primary">{i.email}<small>par {i.invitedByName ?? '—'}</small></span></td>
                    <td><span className="ds-chip">{MEMBERSHIP_ROLE_LABEL[i.role]}</span></td>
                    <td><span className={`pill ${state === 'en_attente' ? 'pill--warn' : state === 'acceptee' ? 'pill--ok' : 'pill--muted'}`}>{INVITATION_STATE_LABEL[state]}</span></td>
                    <td className="ds-mono">{fmtDate(i.expiresAt)}</td>
                    <td style={{ textAlign: 'right' }}>{state === 'en_attente' ? <button className="btn btn-ghost btn-sm" onClick={() => revoke(i.id)} disabled={pending}>Révoquer</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      ) : null}
    </article>
  );
}

function PermissionMatrix() {
  return (
    <article className="card settings-card">
      <div className="settings-card-head">
        <div>
          <h2>Matrice de permissions</h2>
          <p className="hint">
            Ce que chaque rôle peut faire, module par module. Le serveur applique ces règles à chaque
            action ; l’interface ne fait que les refléter. <b>Séparation des tâches</b> : l’auditeur
            rédige ses constats mais ne modifie jamais ce qu’il audite.
          </p>
        </div>
      </div>
      <div className="ds-scroll">
        <table className="perm-matrix">
          <thead>
            <tr><th>Module</th>{MEMBERSHIP_ROLES.map((r) => <th key={r} title={MEMBERSHIP_ROLE_PURPOSE[r]}>{MEMBERSHIP_ROLE_LABEL[r]}</th>)}</tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((m) => (
              <tr key={m.key}>
                <td>{m.label}</td>
                {MEMBERSHIP_ROLES.map((r) => {
                  const p = modulePermission(r, m.key);
                  return <td key={r}><span className={`perm-cell perm--${p}`}>{PERM_LABEL[p]}</span></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="perm-legend">
        <span><span className="perm-cell perm--gestion">Gestion</span> créer, modifier, supprimer</span>
        <span><span className="perm-cell perm--constat">Constats</span> rédiger des constats d’audit sans modifier l’objet audité</span>
        <span><span className="perm-cell perm--lecture">Lecture</span> consulter uniquement</span>
      </div>
    </article>
  );
}
