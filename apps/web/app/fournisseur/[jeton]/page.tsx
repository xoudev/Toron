import { SUPPLIER_QUESTIONS, portalAccess } from '@toron/core';
import { resolvePortalRequest } from '@toron/db';
import { BrandMark } from '@toron/ui';
import type { Metadata } from 'next';

import { appDb } from '@/lib/db';
import { frDate, todayParis } from '@/lib/format';

import { PortalForm } from './portal-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Questionnaire fournisseur — Toron',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

/**
 * Portail de réponse fournisseur : page publique, sans compte. Le lien
 * personnel suffit ; il ne donne accès qu'au questionnaire de la demande.
 */
export default async function SupplierPortalPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  const request = await resolvePortalRequest(appDb().db, jeton);

  if (!request) {
    return (
      <Notice title="Lien inutilisable">
        <p role="alert">Ce lien est inconnu ou incomplet. Ouvrez-le tel qu’il vous a été transmis, ou demandez-en un nouveau à votre interlocuteur.</p>
      </Notice>
    );
  }

  const access = portalAccess(request.status, request.expiresOn, todayParis());
  if (access === 'soumis') {
    return (
      <Notice title="Réponse transmise">
        <p>
          Merci. Vos réponses ont été transmises à <b>{request.organisationName}</b>
          {request.submittedAt ? <> le {frDate(todayParis(request.submittedAt))}</> : null}. Elles ne sont plus modifiables par ce
          lien ; pour toute correction, contactez votre interlocuteur.
        </p>
      </Notice>
    );
  }
  if (access === 'expire') {
    return (
      <Notice title="Lien expiré">
        <p role="alert">
          Ce lien n’est plus valable depuis le {frDate(request.expiresOn)}. Demandez un nouveau lien à <b>{request.organisationName}</b> :
          les réponses déjà enregistrées seront conservées.
        </p>
      </Notice>
    );
  }
  if (access === 'clos') {
    return (
      <Notice title="Demande close">
        <p>{request.organisationName} a clos cette demande. Aucune réponse n’est plus attendue par ce lien.</p>
      </Notice>
    );
  }

  return (
    <main className="portal-page">
      <header className="portal-head">
        <span className="org-brand"><BrandMark size={22} /><b>toron</b></span>
        <h1>Questionnaire de sécurité fournisseur</h1>
        <p>
          <b>{request.organisationName}</b> demande à <b>{request.supplierName}</b> de répondre à {SUPPLIER_QUESTIONS.length} questions
          sur la sécurité de ses prestations, avant le <b>{frDate(request.dueOn)}</b>.
        </p>
        {request.message ? (
          <blockquote className="portal-message">
            <span>Message de {request.organisationName}</span>
            {request.message}
          </blockquote>
        ) : null}
        <p className="portal-hint">
          Vous pouvez enregistrer vos réponses et revenir plus tard par le même lien, jusqu’au {frDate(request.expiresOn)}.
          Une fois envoyées, elles ne sont plus modifiables. Répondez « Sans objet » quand une question ne concerne pas votre
          prestation, et précisez en commentaire ce qui mérite de l’être.
        </p>
      </header>
      <PortalForm token={jeton} answers={request.answers} comments={request.comments} />
      <footer className="portal-foot">
        Ce lien est personnel : ne le transférez pas. Aucune autre information de {request.organisationName} n’est accessible depuis cette page.
      </footer>
    </main>
  );
}
