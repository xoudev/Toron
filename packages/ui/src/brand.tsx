// Les deux marques SVG (identité fournie — docs/design). Deux rôles,
// jamais fusionnés : « strates » = la marque produit ; « poinçon » = le
// sceau frappé sur les livrables générés, jamais un logo.

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4.4" width="16" height="3.2" rx="1.6" fill="currentColor" />
      <rect x="4" y="10.4" width="16" height="3.2" rx="1.6" fill="currentColor" />
      <rect x="4" y="16.4" width="16" height="3.2" rx="1.6" fill="currentColor" />
      <rect x="7.6" y="1.4" width="2.8" height="21.2" rx="1.4" fill="var(--accent)" />
      <rect x="7.6" y="10.4" width="2.8" height="3.2" fill="currentColor" />
    </svg>
  );
}

export function PoinconMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.6 L21 12 L12 21.4 L3 12 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <rect x="0.6" y="10.8" width="22.8" height="2.4" rx="1.2" fill="var(--accent)" />
    </svg>
  );
}
