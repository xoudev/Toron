'use client';

import {
  PORTAL_COMMENT_MAX, SUPPLIER_ANSWERS, SUPPLIER_ANSWER_LABEL, SUPPLIER_QUESTIONS, portalMissing,
  type SupplierAnswer, type SupplierAnswers,
} from '@toron/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { savePortalAction } from './actions';

export function PortalForm({ token, answers: initialAnswers, comments: initialComments }: { token: string; answers: Partial<SupplierAnswers>; comments: Record<string, string> }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Partial<SupplierAnswers>>(initialAnswers);
  const [comments, setComments] = useState<Record<string, string>>(initialComments);
  const [openComments, setOpenComments] = useState<Set<string>>(() => new Set(Object.keys(initialComments)));
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const missing = portalMissing(answers);
  const answered = SUPPLIER_QUESTIONS.length - missing.length;

  function save(submit: boolean) {
    setStatus(null);
    start(async () => {
      const r = await savePortalAction(token, { answers, comments, submit });
      if (!r.ok) {
        setStatus({ kind: 'error', text: r.error.message });
        setConfirming(false);
        return;
      }
      if (r.data.submitted) {
        router.refresh();
        return;
      }
      const at = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      setStatus({ kind: 'ok', text: `Brouillon enregistré à ${at} — vous pouvez revenir plus tard par le même lien.` });
    });
  }

  function choose(key: string, a: SupplierAnswer) {
    setAnswers((prev) => ({ ...prev, [key]: a }));
    setConfirming(false);
  }

  return (
    <form className="portal-form" onSubmit={(e) => { e.preventDefault(); setConfirming(true); }}>
      {SUPPLIER_QUESTIONS.map((q, i) => {
        const head = i === 0 || SUPPLIER_QUESTIONS[i - 1]!.theme !== q.theme ? <h2 className="portal-theme">{q.theme}</h2> : null;
        const commentOpen = openComments.has(q.key);
        return (
          <div key={q.key}>
            {head}
            <fieldset className={`portal-question${answers[q.key] ? ' is-answered' : ''}`}>
              <legend><span className="portal-num">{i + 1}</span>{q.label}</legend>
              <div className="sup-answers" role="radiogroup" aria-label={`Réponse à la question ${i + 1}`}>
                {SUPPLIER_ANSWERS.map((a) => (
                  <label key={a}>
                    <input type="radio" name={`q-${q.key}`} value={a} checked={answers[q.key] === a} onChange={() => choose(q.key, a)} />
                    {SUPPLIER_ANSWER_LABEL[a]}
                  </label>
                ))}
              </div>
              {commentOpen ? (
                <label className="field portal-comment">
                  Commentaire (précisions, périmètre, pièces disponibles)
                  <textarea
                    rows={2} maxLength={PORTAL_COMMENT_MAX} value={comments[q.key] ?? ''}
                    onChange={(e) => setComments((prev) => ({ ...prev, [q.key]: e.target.value }))}
                  />
                </label>
              ) : (
                <button type="button" className="portal-add-comment" onClick={() => setOpenComments((prev) => new Set(prev).add(q.key))}>
                  Ajouter un commentaire
                </button>
              )}
            </fieldset>
          </div>
        );
      })}

      <div className="portal-bar" aria-live="polite">
        <span className="portal-progress">
          <span className="portal-progress-track"><span style={{ width: `${Math.round((answered / SUPPLIER_QUESTIONS.length) * 100)}%` }} /></span>
          {answered}/{SUPPLIER_QUESTIONS.length} réponses
        </span>
        {status ? <span className={status.kind === 'error' ? 'form-error' : 'portal-saved'} role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</span> : null}
        <span className="spacer" />
        {confirming ? (
          <>
            <span className="portal-confirm">Envoyer définitivement vos réponses ?</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={pending}>Revoir</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => save(true)} disabled={pending}>{pending ? 'Envoi…' : 'Confirmer l’envoi'}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(false)} disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer le brouillon'}</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending || missing.length > 0} title={missing.length > 0 ? 'Répondez à toutes les questions pour envoyer' : undefined}>
              Envoyer mes réponses
            </button>
          </>
        )}
      </div>
    </form>
  );
}
