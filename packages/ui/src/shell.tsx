import {
  Alert02Icon,
  Analytics01Icon,
  Audit01Icon,
  Building03Icon,
  ClipboardIcon,
  CubeIcon,
  DangerIcon,
  BookOpen01Icon,
  CheckmarkSquare02Icon,
  DashboardSquare01Icon,
  File02Icon,
  FileCheckIcon,
  FileSecurityIcon,
  Flowchart01Icon,
  Presentation01Icon,
  RefreshIcon,
  Settings01Icon,
  Shield02Icon,
  SmileIcon,
  Task01Icon,
  TaskEdit01Icon,
  Upload04Icon,
  UserAccountIcon,
  UserGroupIcon,
  WorkflowCircle06Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ReactNode } from 'react';

import { BrandMark } from './brand.tsx';
import { NavToggle } from './nav-toggle.tsx';
import { NotificationsTrigger } from './notifications-trigger.tsx';
import { SearchTrigger } from './search-trigger.tsx';

// Shell applicatif (M0-5) : sidebar 236px + topbar 52px, d'après la
// maquette de référence. Composants serveur — l'interactivité (bascule de
// thème, ouverture de la navigation sur écran étroit) vit dans des
// composants client dédiés.

export interface NavItem {
  label: string;
  href: string;
  /** Identifiant historique conservé pour compatibilité avec les menus. */
  iconPath: string;
  active?: boolean;
  /** Item annoncé mais pas encore livré (phase ultérieure) : non cliquable. */
  disabled?: boolean;
  badge?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="app-shell">
      {sidebar}
      <div className="app-main">{children}</div>
    </div>
  );
}

export function Sidebar({
  tenantName,
  tenantDetail,
  groups,
  userName,
  userRole,
  footerActions,
}: {
  tenantName: string;
  tenantDetail: string;
  groups: NavGroup[];
  userName: string;
  userRole: string;
  /** Liens et boutons de compte (changer d'organisation, se déconnecter). */
  footerActions?: ReactNode;
}) {
  return (
    <aside className="sidebar" id="navigation-principale">
      <div className="sidebar-brand">
        <span style={{ color: 'var(--text)' }}>
          <BrandMark size={24} />
        </span>
        <span className="sidebar-wordmark">toron</span>
      </div>

      <div className="sidebar-tenant">
        <span className="sidebar-tenant-avatar">{tenantName.charAt(0).toUpperCase()}</span>
        <span>
          <b className="sidebar-tenant-name">{tenantName}</b>
          <small className="sidebar-tenant-detail">{tenantDetail}</small>
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="Navigation principale">
        {groups.map((group) => (
          <div className="nav-group" key={group.title}>
            <h6 className="nav-group-title">{group.title}</h6>
            {group.items.map((item) => (
              <SidebarItem key={item.href} item={item} />
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="eu-note">
          <span className="eu-note-dot" />
          DONNÉES HÉBERGÉES EN UE
        </div>
        <div className="sidebar-user">
          <span className="sidebar-user-avatar">{initials(userName)}</span>
          <span>
            <b className="sidebar-user-name">{userName}</b>
            <small className="sidebar-user-role">{userRole}</small>
          </span>
        </div>
        {footerActions ? <div className="sidebar-actions">{footerActions}</div> : null}
      </div>
    </aside>
  );
}

function SidebarItem({ item }: { item: NavItem }) {
  const icon = <NavigationIcon label={item.label} />;
  const badge = item.badge ? <span className="nav-badge">{item.badge}</span> : null;

  if (item.disabled) {
    return (
      <span className="nav-item" aria-disabled="true" title="Disponible dans une phase ultérieure">
        {icon}
        {item.label}
        {badge}
      </span>
    );
  }
  return (
    <a className="nav-item" href={item.href} aria-current={item.active ? 'page' : undefined}>
      {icon}
      {item.label}
      {badge}
    </a>
  );
}

function NavigationIcon({ label }: { label: string }) {
  const icon =
    label === 'Tableau de bord' ? DashboardSquare01Icon :
    label === 'Mon travail' ? Task01Icon :
    label === 'Référentiels' ? BookOpen01Icon :
    label === 'Contrôles internes' ? CheckmarkSquare02Icon :
    label === 'Obligations' ? ClipboardIcon :
    label === 'Traitements RGPD' ? UserAccountIcon :
    label === 'Rapport de direction' ? Analytics01Icon :
    label === 'Plan d’action' ? TaskEdit01Icon :
    label === 'Registre des risques' ? DangerIcon :
    label === 'Ateliers EBIOS RM' ? WorkflowCircle06Icon :
    label === 'Incidents' ? Alert02Icon :
    label === 'Continuité d’activité' ? RefreshIcon :
    label === 'Cartographie des actifs' ? CubeIcon :
    label === 'Documents' ? File02Icon :
    label === 'Preuves' ? FileSecurityIcon :
    label === 'Dérogations' ? Shield02Icon :
    label === 'Audits internes' ? Audit01Icon :
    label === 'Fournisseurs' ? Building03Icon :
    label === 'Sensibilisation' ? UserGroupIcon :
    label === 'Revue de direction' ? Presentation01Icon :
    label === 'Processus' ? Flowchart01Icon :
    label === 'Non-conformités' ? FileCheckIcon :
    label === 'Satisfaction client' ? SmileIcon :
    label === 'Importer depuis Excel' ? Upload04Icon :
    label === 'Paramètres' ? Settings01Icon :
    DashboardSquare01Icon;
  return <HugeiconsIcon icon={icon} className="nav-item-icon" size={18} strokeWidth={1.7} aria-hidden="true" />;
}

export function Topbar({
  crumbRoot,
  crumbCurrent,
  actions,
}: {
  crumbRoot: string;
  crumbCurrent: string;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      <NavToggle />
      <span className="topbar-crumb">
        <span className="topbar-crumb-root">{crumbRoot} / </span>
        <b>{crumbCurrent}</b>
      </span>
      <div className="topbar-actions">
        <SearchTrigger />
        <NotificationsTrigger />
        {actions}
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '·';
}
