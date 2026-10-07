import { moduleForSegment } from '@toron/core';
import type { NavGroup } from '@toron/ui';

// Navigation du produit (correspondance §9 du PLAN). L'item actif est
// déterminé par le chemin courant ; « Mon travail » porte le nombre
// d'échéances dépassées ou à moins de 7 jours.
export function buildNav(slug: string, pathname: string, urgentWork = 0, disabledModules: readonly string[] = []): NavGroup[] {
  const base = `/t/${slug}`;
  const isActive = (href: string): boolean =>
    href === base ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);

  const groups: NavGroup[] = [
    {
      title: 'Pilotage',
      items: [
        {
          label: 'Tableau de bord',
          href: base,
          active: isActive(base),
          iconPath: 'M4 4.5h5.5v5.5H4z M14.5 4.5H20v5.5h-5.5z M4 14.5h5.5V20H4z M14.5 14.5H20V20h-5.5z',
        },
        {
          label: 'Mon travail',
          href: `${base}/mon-travail`,
          active: isActive(`${base}/mon-travail`),
          iconPath: 'M5 6.5h2 M10 6.5h9 M5 12h2 M10 12h9 M5 17.5h2 M10 17.5h9',
          badge: urgentWork > 0 ? String(urgentWork) : undefined,
        },
        {
          label: 'Référentiels',
          href: `${base}/referentiels`,
          active: isActive(`${base}/referentiels`),
          iconPath: 'M4 6.5h16 M4 12h16 M4 17.5h16',
        },
        {
          label: 'Contrôles internes',
          href: `${base}/controles`,
          active: isActive(`${base}/controles`),
          iconPath: 'M5 12.5 9.5 17 19 7.5 M4 4.5h16v16H4z',
        },
        {
          label: 'Obligations',
          href: `${base}/obligations`,
          active: isActive(`${base}/obligations`),
          iconPath: 'M7 3.5h10v17H7z M10 9.5l1.6 1.6L14.5 8 M10 15h4.5',
        },
        {
          label: 'Traitements RGPD',
          href: `${base}/traitements`,
          active: isActive(`${base}/traitements`),
          iconPath: 'M12 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M5 20.5c.6-3.6 3.4-6 7-6s6.4 2.4 7 6',
        },
        {
          label: 'Rapport de direction',
          href: `${base}/rapport`,
          active: isActive(`${base}/rapport`),
          iconPath: 'M5 20V10 M10 20V4 M15 20v-7 M20 20v-4 M3.5 20.5h17',
        },
        {
          label: 'Plan d’action',
          href: `${base}/plan-action`,
          active: isActive(`${base}/plan-action`),
          iconPath: 'M12 4.4 20.4 19H3.6Z M12 10v4 M12 16.4v.2',
        },
      ],
    },
    {
      title: 'Risques',
      items: [
        {
          label: 'Registre des risques',
          href: `${base}/risques`,
          active: isActive(`${base}/risques`),
          iconPath: 'M12 3.6 20.4 12 12 20.4 3.6 12Z',
        },
        {
          label: 'Ateliers EBIOS RM',
          href: `${base}/ebios`,
          active: isActive(`${base}/ebios`),
          iconPath: 'M6 4.5h4v4H6z M14 15.5h4v4h-4z M8 8.5v3a3 3 0 0 0 3 3h3',
        },
        {
          label: 'Incidents',
          href: `${base}/incidents`,
          active: isActive(`${base}/incidents`),
          iconPath: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 8v4.6 M12 15.8v.2',
        },
        {
          label: 'Cartographie des actifs',
          href: `${base}/actifs`,
          active: isActive(`${base}/actifs`),
          iconPath: 'M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z M4 7.5l8 3.5 8-3.5 M12 11v9',
        },
      ],
    },
    {
      title: 'Système de management',
      items: [
        {
          label: 'Documents',
          href: `${base}/documents`,
          active: isActive(`${base}/documents`),
          iconPath: 'M7 3.5h6.5L18 8v12.5H7z M13.5 3.5V8H18 M9.5 12.5h6 M9.5 15.5h6',
        },
        {
          label: 'Preuves',
          href: `${base}/preuves`,
          active: isActive(`${base}/preuves`),
          iconPath: 'M6.5 4h11v16h-11z M9.5 8.5h5 M9.5 12h5 M9.5 15.5h3',
        },
        {
          label: 'Dérogations',
          href: `${base}/derogations`,
          active: isActive(`${base}/derogations`),
          iconPath: 'M12 3.5 19.5 6.5v5.2c0 4.3-3.1 7.6-7.5 8.8-4.4-1.2-7.5-4.5-7.5-8.8V6.5Z M9.2 12h5.6',
        },
        {
          label: 'Audits',
          href: `${base}/audits`,
          active: isActive(`${base}/audits`),
          iconPath: 'M9 5.5h6 M7 6.5h10v13H7z M9.5 12.5l1.8 1.8 3.5-3.8',
        },
        {
          label: 'Fournisseurs',
          href: `${base}/fournisseurs`,
          active: isActive(`${base}/fournisseurs`),
          iconPath: 'M4 8.5 12 4.5l8 4v8l-8 4-8-4z M4 8.5l8 4 8-4 M12 12.5v8',
        },
        {
          label: 'Revue de direction',
          href: `${base}/revue-direction`,
          active: isActive(`${base}/revue-direction`),
          iconPath: 'M4.5 6.5h15v13h-15z M4.5 10.5h15 M8.5 4v4 M15.5 4v4',
        },
      ],
    },
    {
      title: 'Qualité',
      items: [
        {
          label: 'Processus',
          href: `${base}/processus`,
          active: isActive(`${base}/processus`),
          iconPath: 'M6 4.5h4v4H6z M14 15.5h4v4h-4z M8 8.5v3a3 3 0 0 0 3 3h3',
        },
        {
          label: 'Non-conformités',
          href: `${base}/non-conformites`,
          active: isActive(`${base}/non-conformites`),
          iconPath: 'M8.5 3.5h7L20.5 8.5v7L15.5 20.5h-7L3.5 15.5v-7z M9.7 9.7l4.6 4.6 M14.3 9.7l-4.6 4.6',
        },
      ],
    },
    {
      title: 'Système',
      items: [
        {
          label: 'Importer depuis Excel',
          href: `${base}/import`,
          active: isActive(`${base}/import`),
          iconPath: 'M12 3.5v10 M8.5 10 12 13.5 15.5 10 M5 15.5v3.5h14v-3.5',
        },
        {
          label: 'Paramètres',
          href: `${base}/parametres`,
          active: isActive(`${base}/parametres`),
          iconPath: 'M4 8h9 M17 8h3 M4 16h3 M11 16h9 M14 6.5v3 M9 14.5v3',
        },
      ],
    },
  ];
  // Les modules masqués par l'organisation disparaissent de la navigation.
  const hidden = (href: string) => {
    const m = moduleForSegment(href.slice(base.length + 1));
    return m !== null && disabledModules.includes(m);
  };
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !hidden(i.href)) }))
    .filter((g) => g.items.length > 0);
}
