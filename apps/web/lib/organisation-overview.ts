import 'server-only';

import { isModuleEnabled, organisationHeadline, type OptionalModule, type ScopeKind } from '@toron/core';
import { getOrganisationProfile, listScopes, withTenant, type OrganisationProfile } from '@toron/db';
import { cache } from 'react';

import { appDb } from './db.ts';

export interface OrganisationOverview {
  profile: OrganisationProfile;
  scopeKinds: ScopeKind[];
  /** « Périmètre SMSI + QMS · 148 salariés · 3 sites », dérivé des données réelles. */
  headline: string;
  disabledModules: OptionalModule[];
  enabled: (module: OptionalModule) => boolean;
}

/**
 * Profil d'organisation partagé par le layout (sidebar) et les pages :
 * mémoïsé par requête pour ne pas doubler les lectures.
 */
export const getOrganisationOverview = cache(async (tenantId: string): Promise<OrganisationOverview> => {
  const { profile, scopes } = await withTenant(appDb().db, tenantId, async (tx) => ({
    profile: await getOrganisationProfile(tx),
    scopes: await listScopes(tx),
  }));
  const scopeKinds = scopes.map((s) => s.kind as ScopeKind);
  return {
    profile,
    scopeKinds,
    headline: organisationHeadline({ scopeKinds, siteCount: profile.siteCount, employeeCount: profile.employeeCount }),
    disabledModules: profile.disabledModules,
    enabled: (module) => isModuleEnabled(profile.disabledModules, module),
  };
});
