import type { ReactNode } from 'react';

import { BrandMark } from './brand.tsx';

// Shell applicatif (M0-5) : sidebar 236px + topbar 52px, d'après la
// maquette de référence. Composants serveur — la seule interactivité
// (bascule de thème) vit dans theme-toggle.tsx.

export interface NavItem {
  label: string;
  href: string;
  /** Chemin SVG (trait 1.5–2px) — icônes monochromes minimalistes. */
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
}: {
  tenantName: string;
  tenantDetail: string;
  groups: NavGroup[];
  userName: string;
  userRole: string;
}) {
  return (
    <aside className="sidebar">
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
      </div>
    </aside>
  );
}

function SidebarItem({ item }: { item: NavItem }) {
  const icon = (
    <svg
      className="nav-item-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={item.iconPath} />
    </svg>
  );
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
      <span className="topbar-crumb">
        {crumbRoot} / <b>{crumbCurrent}</b>
      </span>
      <div className="topbar-actions">{actions}</div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '·';
}
