'use client';

import { SCOPE_KINDS, SCOPE_KIND_LABEL } from '@toron/core';
import { useActionState, useState } from 'react';

import { createTenantAction, type CreateTenantState } from './actions';

const initialState: CreateTenantState = { erreur: null };

export function CreateTenantForm({ open: initiallyOpen }: { open: boolean }) {
  const [state, formAction, pending] = useActionState(createTenantAction, initialState);
  const [open, setOpen] = useState(initiallyOpen);

  if (!open) {
    return (
      <button className="btn btn-ghost" type="button" onClick={() => setOpen(true)}>
        + Créer une organisation
      </button>
    );
  }

  return (
    <form action={formAction} className="org-create">
      <h2>Créer une organisation</h2>
      <p className="org-help">
        Vous en devenez propriétaire. Un premier périmètre de management est créé avec elle :
        c’est lui qui portera vos référentiels, risques et preuves. Vous pourrez en ajouter
        d’autres dans les paramètres.
      </p>
      <label>
        Nom de l’organisation
        <input name="name" minLength={2} maxLength={120} required autoComplete="organization" placeholder="Ex. Meridiane Logistics" />
      </label>
      <label>
        Nom du premier périmètre
        <input name="scopeName" minLength={2} maxLength={120} required defaultValue="Périmètre principal" />
      </label>
      <label>
        Nature du périmètre
        <select name="scopeKind" defaultValue="mixte" required>
          {SCOPE_KINDS.map((k) => (
            <option key={k} value={k}>{SCOPE_KIND_LABEL[k]}</option>
          ))}
        </select>
      </label>
      {state.erreur ? <p role="alert">{state.erreur}</p> : null}
      <div className="org-form-actions">
        {!initiallyOpen ? (
          <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </button>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Création…' : 'Créer l’organisation'}
        </button>
      </div>
    </form>
  );
}
