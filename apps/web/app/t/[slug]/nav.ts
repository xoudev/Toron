import type { NavGroup } from '@toron/ui';

// Navigation du produit (correspondance §9 du PLAN). Les modules des phases
// ultérieures sont annoncés mais désactivés ; « Référentiels » est livré
// (module 5.2). L'item actif est déterminé par le chemin courant.
export function buildNav(slug: string, pathname: string): NavGroup[] {
  const base = `/t/${slug}`;
  const isActive = (href: string): boolean =>
    href === base ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);

  return [
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
          label: 'Référentiels',
          href: `${base}/referentiels`,
          active: isActive(`${base}/referentiels`),
          iconPath: 'M4 6.5h16 M4 12h16 M4 17.5h16',
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
          disabled: true,
          iconPath: 'M6 4.5h4v4H6z M14 15.5h4v4h-4z M8 8.5v3a3 3 0 0 0 3 3h3',
        },
        {
          label: 'Incidents',
          href: `${base}/incidents`,
          disabled: true,
          iconPath: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 8v4.6 M12 15.8v.2',
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
          disabled: true,
          iconPath: 'M6.5 4h11v16h-11z M9.5 8.5h5 M9.5 12h5 M9.5 15.5h3',
        },
        {
          label: 'Audits',
          href: `${base}/audits`,
          disabled: true,
          iconPath: 'M9 5.5h6 M7 6.5h10v13H7z M9.5 12.5l1.8 1.8 3.5-3.8',
        },
        {
          label: 'Fournisseurs',
          href: `${base}/fournisseurs`,
          disabled: true,
          iconPath: 'M4 8.5 12 4.5l8 4v8l-8 4-8-4z M4 8.5l8 4 8-4 M12 12.5v8',
        },
        {
          label: 'Revue de direction',
          href: `${base}/revue-direction`,
          disabled: true,
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
          disabled: true,
          iconPath: 'M6 4.5h4v4H6z M14 15.5h4v4h-4z M8 8.5v3a3 3 0 0 0 3 3h3',
        },
        {
          label: 'Non-conformités',
          href: `${base}/non-conformites`,
          disabled: true,
          iconPath: 'M8.5 3.5h7L20.5 8.5v7L15.5 20.5h-7L3.5 15.5v-7z M9.7 9.7l4.6 4.6 M14.3 9.7l-4.6 4.6',
        },
      ],
    },
    {
      title: 'Système',
      items: [
        {
          label: 'Paramètres',
          href: `${base}/parametres`,
          disabled: true,
          iconPath: 'M4 8h9 M17 8h3 M4 16h3 M11 16h9 M14 6.5v3 M9 14.5v3',
        },
      ],
    },
  ];
}
