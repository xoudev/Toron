'use client';

import { useActionState } from 'react';

import { createTenantAction, type CreateTenantState } from './actions';

const initialState: CreateTenantState = { erreur: null };

export function CreateTenantForm() {
  const [state, formAction, pending] = useActionState(createTenantAction, initialState);

  return (
    <form action={formAction}>
      <h2>Créer une organisation</h2>
      <label>
        Nom de l’organisation
        <input name="name" minLength={2} maxLength={120} required />
      </label>
      {state.erreur ? <p role="alert">{state.erreur}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Création…' : 'Créer'}
      </button>
    </form>
  );
}
