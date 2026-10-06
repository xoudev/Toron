'use client';

import type { MembershipRole } from '@toron/core';
import type {
  AuditRow, InvitationRow, LegalEntityRow, OrganisationProfile, ScopeDetail, SiteRow, TenantMemberDetail,
} from '@toron/db';

import { SectionDonnees } from './section-donnees';
import { SectionJournal } from './section-journal';
import { SectionMembres } from './section-membres';
import { SectionOrganisation } from './section-organisation';
import { SectionPerimetres } from './section-perimetres';
import { SectionSecurite } from './section-securite';
import { SECTIONS, type Section } from './sections';

export interface Viewer {
  userId: string;
  role: MembershipRole;
  twoFactorEnabled: boolean;
  canConfigure: boolean;
  canManageMembers: boolean;
}

export interface JournalPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  filtre: string;
}

export function ParametresClient(props: {
  slug: string;
  section: Section;
  viewer: Viewer;
  profile: OrganisationProfile;
  entities: LegalEntityRow[];
  sites: SiteRow[];
  scopes: ScopeDetail[];
  members: TenantMemberDetail[];
  invitations: InvitationRow[];
  pendingInvitations: number;
  journal: JournalPage;
  exportTables: string[];
}) {
  const { slug, section } = props;
  const badges: Partial<Record<Section, string>> = {
    perimetres: String(props.scopes.length),
    membres: props.pendingInvitations > 0 ? `${props.members.length} · ${props.pendingInvitations} inv.` : String(props.members.length),
  };

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Sections des paramètres">
        {SECTIONS.map((s) => (
          <a key={s.key} href={`/t/${slug}/parametres?section=${s.key}`} aria-current={s.key === section ? 'page' : undefined}>
            {s.label}
            {badges[s.key] ? <span className="nav-badge">{badges[s.key]}</span> : null}
          </a>
        ))}
      </nav>
      <div className="settings-panel">
        {section === 'organisation' ? (
          <SectionOrganisation slug={slug} viewer={props.viewer} profile={props.profile} entities={props.entities} sites={props.sites} />
        ) : null}
        {section === 'perimetres' ? (
          <SectionPerimetres slug={slug} viewer={props.viewer} scopes={props.scopes} entities={props.entities} sites={props.sites} />
        ) : null}
        {section === 'membres' ? (
          <SectionMembres slug={slug} viewer={props.viewer} members={props.members} invitations={props.invitations} />
        ) : null}
        {section === 'securite' ? (
          <SectionSecurite viewer={props.viewer} members={props.members} profile={props.profile} />
        ) : null}
        {section === 'journal' ? <SectionJournal slug={slug} journal={props.journal} /> : null}
        {section === 'donnees' ? (
          <SectionDonnees slug={slug} viewer={props.viewer} profile={props.profile} tables={props.exportTables} />
        ) : null}
      </div>
    </div>
  );
}
