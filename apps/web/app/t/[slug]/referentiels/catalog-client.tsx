'use client';

import type { ScopeSummary } from '@toron/db';
import { Dialog } from '@toron/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { keepValues } from '@/lib/forms';

import { activateFrameworkAction, createCustomFrameworkAction, setFrameworkHiddenAction } from './actions';

const SCOPE_KIND_LABEL: Record<string, string> = {
  smsi: 'SMSI',
  qms: 'QMS',
  mixte: 'Mixte',
};

export function CreateFrameworkButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    start(async () => {
      const res = await createCustomFrameworkAction(slug, {
        code: String(formData.get('code') ?? ''),
        version: String(formData.get('version') ?? ''),
        name: String(formData.get('name') ?? ''),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Créer un référentiel
      </button>
      {open ? (
        <Dialog title="Créer un référentiel interne" onClose={() => setOpen(false)}>
          <form onSubmit={keepValues(submit)}>
            <p>
              Un référentiel d’exigences propre à votre organisation (exigences groupe, politique interne). Vous
              y ajouterez ses exigences depuis sa page, une fois créé.
            </p>
            <label className="field">
              Code
              <input
                name="code"
                placeholder="exigences_groupe"
                pattern="[a-z0-9_]+"
                title="Minuscules, chiffres et _ uniquement"
                aria-describedby="framework-code-help"
                required
              />
              <span id="framework-code-help" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                Identifiant court : minuscules, chiffres et _ ; il sert de sigle au référentiel dans Toron.
              </span>
            </label>
            <label className="field">
              Version
              <input name="version" placeholder="v1" defaultValue="v1" required />
            </label>
            <label className="field">
              Nom
              <input name="name" placeholder="Exigences internes Groupe" required />
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                {pending ? 'Création…' : 'Créer'}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

export function FrameworkVisibilityButton({ slug, frameworkId, hidden }: { slug: string; frameworkId: string; hidden: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function toggle() {
    setError(null);
    start(async () => {
      const res = await setFrameworkHiddenAction(slug, { frameworkId, hidden: !hidden });
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }
  return (
    <>
      <button className="btn btn-ghost btn-sm" disabled={pending} onClick={toggle} title={hidden ? 'Rétablir dans le catalogue' : 'Masquer du catalogue'}>
        {hidden ? '↺ Rétablir' : '⊘ Masquer'}
      </button>
      {error ? (
        <p className="form-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}

export function ActivateFrameworkButton({
  slug,
  frameworkId,
  scopes,
}: {
  slug: string;
  frameworkId: string;
  scopes: ScopeSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scopeId, setScopeId] = useState(scopes[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const res = await activateFrameworkAction(slug, { frameworkId, scopeId });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  // Sans périmètre, rien à activer : la carte garde son lien « Consulter ».
  if (scopes.length === 0) return null;

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Activer
      </button>
      {open ? (
        <Dialog title="Activer sur un périmètre" onClose={() => setOpen(false)}>
          <p>
            Le référentiel sera suivi sur le périmètre de management choisi. L’activation ne peut pas être
            annulée pour l’instant : consultez d’abord le référentiel si vous hésitez.
          </p>
          <label className="field">
            Périmètre
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {SCOPE_KIND_LABEL[s.kind] ?? s.kind}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button className="btn btn-primary btn-sm" onClick={confirm} disabled={pending || !scopeId}>
              {pending ? 'Activation…' : 'Activer'}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
