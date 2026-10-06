'use client';

import { MEMBERSHIP_ROLE_LABEL, totpRequiredForRole } from '@toron/core';
import type { OrganisationProfile, TenantMemberDetail } from '@toron/db';

import type { Viewer } from './parametres-client';

export function SectionSecurite({ viewer, members, profile }: { viewer: Viewer; members: TenantMemberDetail[]; profile: OrganisationProfile }) {
  const requiredWithout = members.filter((m) => totpRequiredForRole(m.role) && !m.twoFactorEnabled);
  const withTotp = members.filter((m) => m.twoFactorEnabled).length;

  return (
    <>
      <article className="card settings-card">
        <div className="settings-card-head">
          <div>
            <h2>Double authentification (TOTP)</h2>
            <p className="hint">
              Obligatoire pour les rôles Propriétaire, Direction et RSSI ; recommandée pour tous. Un
              membre concerné sans TOTP voit son accès à l’organisation bloqué jusqu’à l’activation.
            </p>
          </div>
          {viewer.twoFactorEnabled ? <span className="pill pill--ok">Activée sur votre compte</span> : <a className="btn btn-primary btn-sm" href="/securite/2fa">Activer sur mon compte</a>}
        </div>
        <dl className="settings-kv">
          <dt>Membres protégés</dt><dd className="mono">{withTotp} / {members.length}</dd>
          <dt>Rôles à TOTP obligatoire</dt><dd>{MEMBERSHIP_ROLE_LABEL.owner}, {MEMBERSHIP_ROLE_LABEL.direction}, {MEMBERSHIP_ROLE_LABEL.rssi}</dd>
          <dt>Accès bloqués faute de TOTP</dt>
          <dd>{requiredWithout.length === 0 ? <span className="pill pill--ok">Aucun</span> : requiredWithout.map((m) => `${m.name || m.email} (${MEMBERSHIP_ROLE_LABEL[m.role]})`).join(', ')}</dd>
        </dl>
      </article>

      <article className="card settings-card">
        <div className="settings-card-head">
          <div>
            <h2>Mots de passe et sessions</h2>
            <p className="hint">Règles appliquées à tous les comptes de la plateforme.</p>
          </div>
        </div>
        <dl className="settings-kv">
          <dt>Longueur minimale</dt><dd>12 caractères</dd>
          <dt>Stockage</dt><dd>Hachage Argon2id, jamais en clair ni réversible</dd>
          <dt>Cookies de session</dt><dd>HttpOnly, Secure, SameSite — invalidés à la déconnexion</dd>
          <dt>Limitation de débit</dt><dd>Tentatives de connexion plafonnées par adresse IP</dd>
          <dt>En-têtes web</dt><dd>CSP stricte à nonce, HSTS, protection contre le cadrage et le reniflage de type</dd>
        </dl>
      </article>

      <article className="card settings-card">
        <div className="settings-card-head">
          <div>
            <h2>Isolation et hébergement</h2>
            <p className="hint">Ce que l’architecture garantit à votre organisation, indépendamment de la configuration.</p>
          </div>
        </div>
        <dl className="settings-kv">
          <dt>Isolation des données</dt><dd>Politiques de sécurité au niveau des lignes (RLS) PostgreSQL : chaque requête est confinée à votre organisation</dd>
          <dt>Région</dt><dd>{profile.region === 'eu-fr' ? 'Union européenne · France' : profile.region}</dd>
          <dt>Sous-traitants hors UE</dt><dd>Aucun</dd>
          <dt>Journal d’audit</dt><dd>Écriture seule, horodaté, sans aucune fonction d’effacement</dd>
          <dt>Identifiants</dt><dd>UUID partout — aucun identifiant séquentiel exposé</dd>
        </dl>
      </article>

      <article className="card settings-card">
        <div className="settings-card-head">
          <div>
            <h2>Authentification unique (SSO)</h2>
            <p className="hint">
              La fédération SAML / OIDC avec votre annuaire d’entreprise est prévue dans une version
              ultérieure. Les comptes utilisent aujourd’hui un mot de passe fort et le TOTP.
            </p>
          </div>
          <span className="pill pill--muted">À venir</span>
        </div>
      </article>
    </>
  );
}
