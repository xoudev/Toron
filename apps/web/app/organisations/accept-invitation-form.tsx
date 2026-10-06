'use client';

import { startTransition, useActionState } from 'react';

import { keepValues } from '@/lib/forms';

import { acceptInvitationAction, type AcceptInvitationState } from './actions';

const initialState: AcceptInvitationState = { erreur: null };

export function AcceptInvitationForm({ invitationId }: { invitationId: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, initialState);
  return (
    <form onSubmit={keepValues((fd) => startTransition(() => formAction(fd)))} className="org-inline-form">
      <input type="hidden" name="invitationId" value={invitationId} />
      <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
        {pending ? 'Ouverture…' : 'Rejoindre'}
      </button>
      {state.erreur ? <p role="alert">{state.erreur}</p> : null}
    </form>
  );
}
